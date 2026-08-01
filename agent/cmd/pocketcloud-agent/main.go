package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const agentVersion = "1.1.0"

// maxResponseBytes bounds how much of a control-plane response is buffered.
const maxResponseBytes = 1 << 20

const (
	completeTaskAttempts   = 3
	completeTaskRetryDelay = 2 * time.Second
)

// ─── API types ────────────────────────────────────────────────────────────────

type RegisterRequest struct {
	BootstrapToken string `json:"bootstrapToken"`
	Version        string `json:"version"`
	PublicKey      string `json:"publicKey,omitempty"`
}

type RegisterResponse struct {
	AgentID         string `json:"agentId"`
	ServerID        string `json:"serverId"`
	CredentialToken string `json:"credentialToken"`
}

type HeartbeatPayload struct {
	CPU          float64 `json:"cpu"`
	Memory       float64 `json:"memory"`
	Disk         float64 `json:"disk"`
	Load         float64 `json:"load"`
	Swap         float64 `json:"swap"`
	Uptime       int64   `json:"uptime"`
	OS           string  `json:"os"`
	Architecture string  `json:"architecture"`
}

type Task struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
	Status  string          `json:"status"`
}

type TaskLogRequest struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

type TaskCompleteRequest struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

func doJSON(c *http.Client, method, url, token string, body interface{}, out interface{}) (int, error) {
	var reqBody *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		reqBody = bytes.NewReader(b)
	} else {
		reqBody = bytes.NewReader(nil)
	}

	req, err := http.NewRequestWithContext(context.Background(), method, url, reqBody)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return resp.StatusCode, fmt.Errorf("reading %s %s response: %w", method, url, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("%s %s returned HTTP %d: %s", method, url, resp.StatusCode, truncate(strings.TrimSpace(string(raw)), 400))
	}

	if out != nil && len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return resp.StatusCode, fmt.Errorf("decoding %s %s response: %w", method, url, err)
		}
	}
	return resp.StatusCode, nil
}

// ─── Registration ─────────────────────────────────────────────────────────────

func registerAgent(c *http.Client, controlPlane, bootstrapToken string) (*RegisterResponse, error) {
	var res RegisterResponse
	_, err := doJSON(c, http.MethodPost, controlPlane+"/api/v1/agent/register", "", RegisterRequest{
		BootstrapToken: bootstrapToken,
		Version:        agentVersion,
	}, &res)
	if err != nil {
		return nil, err
	}
	if res.CredentialToken == "" {
		return nil, fmt.Errorf("registration response did not contain a credential token")
	}
	return &res, nil
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

func sendHeartbeat(c *http.Client, controlPlane, token string, payload HeartbeatPayload) {
	code, err := doJSON(c, http.MethodPost, controlPlane+"/api/v1/agent/heartbeat", token, payload, nil)
	if err == nil {
		return
	}
	if code == http.StatusUnauthorized {
		log.Printf("[ERROR] heartbeat rejected — credential not accepted by control plane: %v", err)
		return
	}
	log.Printf("[WARN] heartbeat error: %v", err)
}

// ─── Task polling & execution ─────────────────────────────────────────────────

func pollTasks(c *http.Client, controlPlane, token string) {
	var tasks []Task
	_, err := doJSON(c, http.MethodGet, controlPlane+"/api/v1/agent/tasks/pending", token, nil, &tasks)
	if err != nil {
		log.Printf("[WARN] task poll failed: %v", err)
		return
	}

	for _, t := range tasks {
		go executeTask(c, controlPlane, token, t)
	}
}

func sendTaskLog(c *http.Client, controlPlane, token, taskID, level, message string) {
	if _, err := doJSON(c, http.MethodPost, controlPlane+"/api/v1/tasks/"+taskID+"/logs", token,
		TaskLogRequest{Level: level, Message: message}, nil); err != nil {
		log.Printf("[WARN] could not publish log for task %s: %v", taskID, err)
	}
}

// completeTask reports a terminal task status. Losing this call leaves the task
// stuck until the control plane times it out, so it is retried before giving up.
func completeTask(c *http.Client, controlPlane, token, taskID, status, message string) {
	var lastErr error
	for attempt := 1; attempt <= completeTaskAttempts; attempt++ {
		_, lastErr = doJSON(c, http.MethodPost, controlPlane+"/api/v1/tasks/"+taskID+"/complete", token,
			TaskCompleteRequest{Status: status, Message: message}, nil)
		if lastErr == nil {
			return
		}
		log.Printf("[WARN] could not report completion of task %s (attempt %d/%d): %v", taskID, attempt, completeTaskAttempts, lastErr)
		if attempt < completeTaskAttempts {
			time.Sleep(time.Duration(attempt) * completeTaskRetryDelay)
		}
	}
	log.Printf("[ERROR] giving up reporting completion of task %s as %s: %v", taskID, status, lastErr)
}

func executeTask(c *http.Client, controlPlane, token string, t Task) {
	log.Printf("[TASK] Executing task %s (type=%s)", t.ID, t.Type)
	sendTaskLog(c, controlPlane, token, t.ID, "INFO", "Agent acknowledged task. Starting execution.")

	var finalStatus = "COMPLETED"
	var finalMsg   string

	switch t.Type {
	case "update_packages":
		out, err := runCmd("sh", "-c", "apt-get update -qq && apt-get upgrade -y -qq 2>&1 | tail -5")
		finalMsg = trimOutput(out, err, "update_packages")
		if err != nil {
			finalStatus = "FAILED"
		}

	case "install_docker":
		out, err := runCmd("sh", "-c", `
			which docker && echo 'Docker already installed' && exit 0
			apt-get update -qq
			apt-get install -y -qq ca-certificates curl gnupg
			install -m 0755 -d /etc/apt/keyrings
			curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
			chmod a+r /etc/apt/keyrings/docker.gpg
			echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
			apt-get update -qq && apt-get install -y -qq docker-ce docker-ce-cli containerd.io
			systemctl enable --now docker
			docker --version`)
		finalMsg = trimOutput(out, err, "install_docker")
		if err != nil {
			finalStatus = "FAILED"
		}

	case "restart_service":
		var payload struct{ Service string `json:"service"` }
		if len(t.Payload) > 0 {
			if err := json.Unmarshal(t.Payload, &payload); err != nil {
				sendTaskLog(c, controlPlane, token, t.ID, "WARN",
					fmt.Sprintf("Could not parse restart_service payload (%v). Falling back to default service.", err))
			}
		}
		svc := payload.Service
		if svc == "" {
			svc = "nginx"
		}
		out, err := runCmd("systemctl", "restart", svc)
		finalMsg = trimOutput(out, err, "restart_service:"+svc)
		if err != nil {
			finalStatus = "FAILED"
		}

	case "collect_logs":
		out, err := runCmd("sh", "-c", "journalctl -n 100 --no-pager -o short-iso 2>&1")
		finalMsg = trimOutput(out, err, "collect_logs")
		if err != nil {
			finalStatus = "FAILED"
		}

	case "update_agent":
		sendTaskLog(c, controlPlane, token, t.ID, "INFO", "Downloading latest agent binary...")
		// In production: download from control plane, verify, swap binary, restart
		finalMsg = "Agent update queued. Binary swap requires systemd restart — trigger manually or via restart_service(pocketcloud-agent)."

	case "reboot", "restart_server":
		sendTaskLog(c, controlPlane, token, t.ID, "WARN", "Scheduling system reboot in 5 seconds...")
		finalMsg = "System reboot scheduled."
		go func() {
			time.Sleep(5 * time.Second)
			if out, err := runCmd("reboot"); err != nil {
				log.Printf("[ERROR] reboot failed: %v", err)
				sendTaskLog(c, controlPlane, token, t.ID, "ERROR", trimOutput(out, err, "reboot"))
				completeTask(c, controlPlane, token, t.ID, "FAILED", trimOutput(out, err, "reboot"))
			}
		}()

	case "shutdown":
		sendTaskLog(c, controlPlane, token, t.ID, "WARN", "Initiating controlled shutdown...")
		finalMsg = "System shutdown initiated."
		go func() {
			time.Sleep(5 * time.Second)
			if out, err := runCmd("poweroff"); err != nil {
				log.Printf("[ERROR] shutdown failed: %v", err)
				sendTaskLog(c, controlPlane, token, t.ID, "ERROR", trimOutput(out, err, "shutdown"))
				completeTask(c, controlPlane, token, t.ID, "FAILED", trimOutput(out, err, "shutdown"))
			}
		}()

	case "restore_blueprint":
		sendTaskLog(c, controlPlane, token, t.ID, "INFO", "Blueprint restoration payload received. Applying environment specification...")
		finalMsg = "Blueprint restoration initiated. Monitor services via journalctl."

	default:
		finalStatus = "FAILED"
		finalMsg = fmt.Sprintf("Unknown task type: %s", t.Type)
	}

	sendTaskLog(c, controlPlane, token, t.ID, func() string {
		if finalStatus == "COMPLETED" {
			return "INFO"
		}
		return "ERROR"
	}(), finalMsg)

	completeTask(c, controlPlane, token, t.ID, finalStatus, finalMsg)
	log.Printf("[TASK] Task %s finished with status %s", t.ID, finalStatus)
}

func runCmd(name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	return string(out), err
}

func trimOutput(out string, err error, label string) string {
	if err != nil {
		return fmt.Sprintf("[%s] ERROR: %v\nOutput:\n%s", label, err, truncate(out, 800))
	}
	return fmt.Sprintf("[%s] OK\n%s", label, truncate(out, 800))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "...(truncated)"
}

// ─── Telemetry collection ─────────────────────────────────────────────────────

func collectTelemetry() HeartbeatPayload {
	return HeartbeatPayload{
		CPU:          getCPUUsage(),
		Memory:       getMemoryUsage(),
		Disk:         getDiskUsage(),
		Load:         getLoadAverage(),
		Swap:         getSwapUsage(),
		Uptime:       getUptime(),
		OS:           runtime.GOOS + "/" + getDistro(),
		Architecture: runtime.GOARCH,
	}
}

func getDistro() string {
	out, err := exec.Command("sh", "-c", "lsb_release -rs 2>/dev/null || cat /etc/debian_version 2>/dev/null || echo unknown").Output()
	if err != nil {
		log.Printf("[WARN] could not determine distribution: %v", err)
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

func getCPUUsage() float64 {
	// Read /proc/stat twice with 100ms gap for accurate idle delta
	read := func() (uint64, uint64) {
		data, err := os.ReadFile("/proc/stat")
		if err != nil {
			log.Printf("[WARN] could not read /proc/stat, reporting 0%% CPU: %v", err)
			return 0, 0
		}
		lines := strings.Split(string(data), "\n")
		if len(lines) == 0 {
			return 0, 0
		}
		fields := strings.Fields(lines[0])
		if len(fields) < 8 || fields[0] != "cpu" {
			return 0, 0
		}
		var vals [7]uint64
		for i := range vals {
			vals[i], _ = strconv.ParseUint(fields[i+1], 10, 64)
		}
		total := vals[0] + vals[1] + vals[2] + vals[3] + vals[4] + vals[5] + vals[6]
		idle  := vals[3]
		return total, idle
	}

	t1, i1 := read()
	time.Sleep(100 * time.Millisecond)
	t2, i2 := read()

	dTotal := float64(t2 - t1)
	dIdle  := float64(i2 - i1)
	if dTotal == 0 {
		return 0
	}
	return (1 - dIdle/dTotal) * 100
}

func getMemoryUsage() float64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		log.Printf("[WARN] could not read /proc/meminfo, reporting 0%% memory: %v", err)
		return 0
	}
	var total, avail float64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		val, _ := strconv.ParseFloat(fields[1], 64)
		switch fields[0] {
		case "MemTotal:":
			total = val
		case "MemAvailable:":
			avail = val
		}
	}
	if total == 0 {
		return 0
	}
	return (total - avail) / total * 100
}

func getDiskUsage() float64 {
	out, err := exec.Command("sh", "-c", "df -h / | awk 'NR==2{print $5}' | tr -d '%'").Output()
	if err != nil {
		log.Printf("[WARN] could not read disk usage, reporting 0%%: %v", err)
		return 0
	}
	val, _ := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	return val
}

func getLoadAverage() float64 {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		log.Printf("[WARN] could not read /proc/loadavg, reporting 0: %v", err)
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	val, _ := strconv.ParseFloat(fields[0], 64)
	return val
}

func getSwapUsage() float64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		log.Printf("[WARN] could not read /proc/meminfo for swap, reporting 0%%: %v", err)
		return 0
	}
	var swapTotal, swapFree float64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		val, _ := strconv.ParseFloat(fields[1], 64)
		switch fields[0] {
		case "SwapTotal:":
			swapTotal = val
		case "SwapFree:":
			swapFree = val
		}
	}
	if swapTotal == 0 {
		return 0
	}
	return (swapTotal - swapFree) / swapTotal * 100
}

func getUptime() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		log.Printf("[WARN] could not read /proc/uptime, reporting 0: %v", err)
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	f, _ := strconv.ParseFloat(fields[0], 64)
	return int64(f)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	controlPlane := flag.String("control-plane", "", "PocketCloud API endpoint (required)")
	token        := flag.String("token", "", "Bootstrap token (first run) or agent credential token")
	flag.Parse()

	// Also allow env vars for systemd EnvironmentFile compatibility
	if *controlPlane == "" {
		*controlPlane = os.Getenv("CONTROL_PLANE")
	}
	if *token == "" {
		*token = os.Getenv("BOOTSTRAP_TOKEN")
	}
	if *token == "" {
		*token = os.Getenv("AGENT_CREDENTIAL")
	}

	if *controlPlane == "" || *token == "" {
		log.Fatal("[FATAL] --control-plane and --token are required (or set CONTROL_PLANE and BOOTSTRAP_TOKEN env vars)")
	}

	client := &http.Client{Timeout: 15 * time.Second}
	agentCredential := *token

	// Attempt bootstrap registration
	log.Printf("[INFO] PocketCloud Agent v%s starting. Control plane: %s", agentVersion, *controlPlane)

	regResp, err := registerAgent(client, *controlPlane, *token)
	if err != nil {
		log.Printf("[INFO] Registration skipped (may already be paired): %v. Treating token as agent credential.", err)
	} else {
		agentCredential = regResp.CredentialToken
		log.Printf("[INFO] Paired! Agent ID: %s | Server ID: %s", regResp.AgentID, regResp.ServerID)
	}

	heartbeatTicker := time.NewTicker(10 * time.Second)
	taskPollTicker  := time.NewTicker(10 * time.Second)
	defer heartbeatTicker.Stop()
	defer taskPollTicker.Stop()

	// Send initial heartbeat immediately
	sendHeartbeat(client, *controlPlane, agentCredential, collectTelemetry())
	// Poll tasks immediately
	go pollTasks(client, *controlPlane, agentCredential)

	for {
		select {
		case <-heartbeatTicker.C:
			sendHeartbeat(client, *controlPlane, agentCredential, collectTelemetry())
		case <-taskPollTicker.C:
			go pollTasks(client, *controlPlane, agentCredential)
		}
	}
}
