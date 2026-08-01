# PocketCloud VPS Validation Test Plans

This document contains comprehensive test plans for VPS-dependent validation phases that require actual infrastructure deployment.

## Phase 1: Real Blueprint Capture Test

### Prerequisites
- Ubuntu 24.04 LTS VPS with SSH access
- PocketCloud control plane running and accessible
- PocketCloud agent installed on VPS
- Admin access to PocketCloud dashboard

### Test Environment Setup

#### 1.1 Install Test Applications
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Nginx
sudo apt update
sudo apt install -y nginx

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Create sample application
mkdir -p ~/test-app
cd ~/test-app
cat > package.json <<EOF
{
  "name": "test-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js"
  }
}
EOF

cat > server.js <<EOF
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from PocketCloud test app');
});
server.listen(3000, () => console.log('Server running on port 3000'));
EOF

# Create Docker Compose stack
cat > docker-compose.yml <<EOF
version: '3.8'
services:
  app:
    image: nginx:alpine
    ports:
      - "8080:80"
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_PASSWORD: testpass
    ports:
      - "5432:5432"
EOF

# Start services
docker-compose up -d
```

#### 1.2 Configure Reverse Proxy
```bash
# Configure Nginx as reverse proxy
sudo tee /etc/nginx/sites-available/test-app <<EOF
server {
    listen 80;
    server_name _;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    
    location /docker/ {
        proxy_pass http://localhost:8080/;
        proxy_set_header Host \$host;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/test-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Blueprint Capture Validation

#### 1.3 Create Blueprint via API
```bash
# Get server ID from PocketCloud dashboard
SERVER_ID="your-server-id"

# Create blueprint
curl -X POST http://your-control-plane/api/v1/blueprints \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "serverId": "'$SERVER_ID'",
    "name": "test-environment",
    "manifest": {
      "name": "test-environment",
      "os": "ubuntu-24.04",
      "packages": ["docker.io", "nginx", "nodejs"],
      "services": [
        {"name": "nginx", "enabled": true},
        {"name": "docker", "enabled": true}
      ],
      "ports": ["80/tcp", "443/tcp", "3000/tcp", "5432/tcp"],
      "dockerCompose": {
        "services": {
          "app": {"image": "nginx:alpine", "ports": ["8080:80"]},
          "db": {"image": "postgres:15-alpine", "ports": ["5432:5432"]}
        }
      }
    }
  }'
```

#### 1.4 Verify Blueprint Contents
```bash
# Retrieve blueprint and verify
curl -X GET http://your-control-plane/api/v1/blueprints/$BLUEPRINT_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected validation checklist:
# ✅ OS information captured (ubuntu-24.04)
# ✅ Installed packages listed (docker.io, nginx, nodejs)
# ✅ Services detected (nginx, docker)
# ✅ Docker containers enumerated (app, db)
# ✅ Compose configuration preserved
# ✅ Ports mapped (80, 443, 3000, 5432)
# ✅ Non-secret environment config included
# ❌ Secrets removed (passwords, keys, tokens)
```

#### 1.5 Verify Secrets Removal
```bash
# Check that sensitive data is NOT in blueprint
# Should NOT contain:
# - Database passwords
# - API keys
# - SSH private keys
# - JWT secrets
# - Environment variables with 'secret', 'password', 'key', 'token'

# Should contain:
# - Package names
# - Service names
# - Port mappings
# - Public configuration
```

#### 1.6 Verify Blueprint Versioning
```bash
# Check that blueprint version was created
curl -X GET http://your-control-plane/api/v1/blueprints/$BLUEPRINT_ID/versions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected:
# ✅ Version number assigned (1)
# ✅ Checksum generated
# ✅ Timestamp recorded
# ✅ Manifest stored
```

### Success Criteria
- [ ] Blueprint created successfully
- [ ] All system components captured
- [ ] Docker containers enumerated
- [ ] Secrets completely removed
- [ ] Checksum generated and valid
- [ ] Version assigned and stored
- [ ] Manifest is valid JSON

---

## Phase 2: Restore Test

### Prerequisites
- Fresh Ubuntu 24.04 LTS VPS (minimal installation)
- PocketCloud control plane running
- Blueprint from Phase 1 available
- Network connectivity between VPS and control plane

### Test Environment Setup

#### 2.1 Install PocketCloud Agent Only
```bash
# On fresh VPS, install ONLY the PocketCloud agent
curl -fsSL http://your-control-plane/agent/install.sh | sudo bash -s -- \
  --token YOUR_BOOTSTRAP_TOKEN \
  --control-plane http://your-control-plane

# Verify agent is running
sudo systemctl status pocketcloud-agent
```

### Blueprint Restore Validation

#### 2.2 Initiate Restore via API
```bash
# Get target server ID (fresh VPS)
TARGET_SERVER_ID="target-server-id"

# Get blueprint version ID from Phase 1
BLUEPRINT_VERSION_ID="blueprint-version-id"

# Initiate restore
curl -X POST http://your-control-plane/api/v1/blueprints/restore \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "blueprintVersionId": "'$BLUEPRINT_VERSION_ID'",
    "targetServerId": "'$TARGET_SERVER_ID'"
  }'
```

#### 2.3 Verify Restore Workflow
```bash
# Monitor task creation
curl -X GET http://your-control-plane/api/v1/tasks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected workflow:
# ✅ Task created with type 'restore_blueprint'
# ✅ Task status transitions: QUEUED → RUNNING → COMPLETED
# ✅ Agent receives task
# ✅ Dependencies installed
# ✅ Files restored
# ✅ Containers started
# ✅ Health checks pass
```

#### 2.4 Verify Dependency Installation
```bash
# SSH into restored VPS
ssh user@restored-vps

# Check packages
dpkg -l | grep -E "docker|nginx|nodejs"

# Expected:
# ✅ docker.io installed
# ✅ nginx installed
# ✅ nodejs installed
```

#### 2.5 Verify Docker Services
```bash
# Check Docker is running
sudo systemctl status docker

# Check containers
docker ps

# Expected:
# ✅ Docker daemon running
# ✅ app container running (nginx:alpine)
# ✅ db container running (postgres:15-alpine)
# ✅ Port mappings correct (8080, 5432)
```

#### 2.6 Verify Application Accessibility
```bash
# Test application
curl http://restored-vps:3000

# Expected:
# ✅ Returns "Hello from PocketCloud test app"

# Test Docker app
curl http://restored-vps:8080

# Expected:
# ✅ Returns nginx welcome page

# Test reverse proxy
curl http://restored-vps/

# Expected:
# ✅ Proxies to application correctly
```

#### 2.7 Verify Nginx Configuration
```bash
# Check Nginx status
sudo systemctl status nginx

# Check configuration
sudo nginx -t

# Expected:
# ✅ Nginx running
# ✅ Configuration valid
# ✅ Reverse proxy rules applied
```

#### 2.8 Verify Database Connectivity
```bash
# Test database connection
docker exec -it pocketcloud-db-1 psql -U postgres -c "SELECT version();"

# Expected:
# ✅ Database accessible
# ✅ PostgreSQL version matches original
```

### Success Criteria
- [ ] Task created and executed successfully
- [ ] All dependencies installed correctly
- [ ] Docker containers started
- [ ] Application accessible on expected ports
- [ ] Nginx reverse proxy working
- [ ] Database container running and accessible
- [ ] Health checks pass
- [ ] Environment matches original blueprint

---

## Phase 3: Backup Recovery Test

### Prerequisites
- PocketCloud control plane with data
- Access to backup system
- Test database with users, servers, blueprints, settings, tasks

### Test Environment Setup

#### 3.1 Create Test Data
```bash
# Create test users
curl -X POST http://your-control-plane/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test1@example.com",
    "password": "TestPassword123!"
  }'

curl -X POST http://your-control-plane/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test2@example.com",
    "password": "TestPassword123!"
  }'

# Create test servers (via bootstrap tokens)
# Create test blueprints (from Phase 1)
# Create test settings
curl -X POST http://your-control-plane/api/v1/settings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "test.setting",
    "value": "test-value",
    "category": "test"
  }'

# Create test tasks
curl -X POST http://your-control-plane/api/v1/tasks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "serverId": "test-server-id",
    "type": "update_packages",
    "payload": {}
  }'
```

### Backup Creation Validation

#### 3.2 Create Control Plane Backup
```bash
# Trigger backup via API
curl -X POST http://your-control-plane/api/v1/backups \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Or via backup script
sudo /opt/pocketcloud/scripts/backup.sh

# Verify backup created
curl -X GET http://your-control-plane/api/v1/backups \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected:
# ✅ Backup file created
# ✅ Checksum generated
# ✅ Timestamp recorded
# ✅ Creator logged
```

#### 3.3 Verify Backup Contents
```bash
# Extract and verify backup contents
# Should include:
# ✅ Users table (test1@example.com, test2@example.com)
# ✅ Servers table (test servers)
# ✅ Blueprints table (test blueprints)
# ✅ Settings table (test.settings)
# ✅ Tasks table (test tasks)
# ✅ Task history (logs, status changes)
# ✅ Audit logs

# Verify database dump
pg_restore -l backup.sql | grep -E "User|Server|Blueprint|Setting|Task"

# Expected:
# ✅ All tables present
# ✅ Row counts match expected
# ✅ Data integrity maintained
```

### Recovery Validation

#### 3.4 Destroy Test Control Plane
```bash
# Stop control plane services
sudo systemctl stop pocketcloud-api
sudo systemctl stop pocketcloud-worker
sudo systemctl stop pocketcloud-task-engine

# Drop database
sudo -u postgres psql -c "DROP DATABASE pocketcloud;"

# Remove configuration (optional)
# sudo rm -rf /opt/pocketcloud
```

#### 3.5 Deploy Fresh PocketCloud Instance
```bash
# Run installer on fresh system
curl -fsSL https://get.pocketcloud.io | sudo bash

# Configure with fresh database
# Follow installation wizard
```

#### 3.6 Restore from Backup
```bash
# Upload backup file to new instance
scp backup.sql user@new-control-plane:/tmp/

# Restore database
sudo -u postgres psql pocketcloud < /tmp/backup.sql

# Or via API
curl -X POST http://new-control-plane/api/v1/backups/restore \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "backupPath": "/tmp/backup.sql"
  }'
```

#### 3.7 Verify Restored Data
```bash
# Test login with original users
curl -X POST http://new-control-plane/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test1@example.com",
    "password": "TestPassword123!"
  }'

# Expected:
# ✅ Login successful
# ✅ JWT token returned

# Verify servers appear
curl -X GET http://new-control-plane/api/v1/servers \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected:
# ✅ Test servers listed
# ✅ Server metadata intact

# Verify blueprints appear
curl -X GET http://new-control-plane/api/v1/blueprints \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected:
# ✅ Test blueprints listed
# ✅ Blueprint versions present
# ✅ Manifests intact

# Verify settings
curl -X GET http://new-control-plane/api/v1/settings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected:
# ✅ test.setting present
# ✅ Value matches original

# Verify task history
curl -X GET http://new-control-plane/api/v1/tasks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected:
# ✅ Test tasks listed
# ✅ Task logs present
# ✅ Status history intact
```

### Success Criteria
- [ ] Backup created successfully
- [ ] All data included in backup
- [ ] Backup checksum valid
- [ ] Fresh instance deployed
- [ ] Restore completes without errors
- [ ] Users can login with original credentials
- [ ] Servers appear with correct metadata
- [ ] Blueprints accessible with versions
- [ ] Settings restored correctly
- [ ] Task history preserved
- [ ] Audit logs intact

---

## Phase 4: Agent Distribution Validation

### Prerequisites
- GitHub Actions workflow configured
- Tagged release (v1.1.0) pushed
- GitHub releases accessible

### Test Agent Download

#### 4.1 Test GitHub Release Download
```bash
# Test direct download from GitHub
curl -L https://github.com/designx-studio/pocketcloud/releases/download/v1.1.0/pocketcloud-agent-linux-x86_64 \
  -o /tmp/test-agent

# Verify binary
chmod +x /tmp/test-agent
/tmp/test-agent --version

# Expected:
# ✅ Download successful
# ✅ Binary executable
# ✅ Version matches v1.1.0
```

#### 4.2 Test Agent Registry Proxy
```bash
# Test via control plane proxy
curl -L http://your-control-plane/api/v1/agent/releases/linux-x86_64 \
  -o /tmp/test-agent-proxy

# Verify headers include source
curl -I http://your-control-plane/api/v1/agent/releases/linux-x86_64

# Expected:
# ✅ Download successful
# ✅ X-Agent-Source: github
# ✅ X-Agent-Version: 1.1.0
```

#### 4.3 Test Installation Script
```bash
# Test full installation on fresh VPS
curl -fsSL http://your-control-plane/agent/install.sh | sudo bash -s -- \
  --token YOUR_BOOTSTRAP_TOKEN \
  --control-plane http://your-control-plane

# Verify agent installed
sudo systemctl status pocketcloud-agent

# Expected:
# ✅ Agent downloads without manual compilation
# ✅ Agent service starts
# ✅ Agent registers with control plane
```

### Success Criteria
- [ ] GitHub releases contain all 3 architectures
- [ ] Direct download from GitHub works
- [ ] Agent registry proxy functions correctly
- [ ] Installation script downloads automatically
- [ ] No manual compilation required
- [ ] Agent installs and registers successfully

---

## Execution Timeline

### Week 1: Infrastructure Setup
- Day 1-2: Deploy test VPS instances
- Day 3: Configure control plane
- Day 4-5: Install agents and verify connectivity

### Week 2: Phase 1 & 2 Testing
- Day 1-2: Setup test environment (Phase 1)
- Day 3-4: Execute blueprint capture tests
- Day 5: Document results and fix issues

### Week 3: Phase 2 & 3 Testing
- Day 1-2: Setup fresh VPS for restore (Phase 2)
- Day 3-4: Execute restore tests
- Day 5: Document results and fix issues

### Week 4: Phase 3 & 4 Testing
- Day 1-2: Execute backup/recovery tests (Phase 3)
- Day 3: Execute agent distribution tests (Phase 4)
- Day 4-5: Final validation and report generation

---

## Troubleshooting Guide

### Common Issues

#### Blueprint Capture Failures
- **Issue**: Blueprint not capturing all services
- **Solution**: Verify agent has sufficient permissions, check systemd service detection

#### Restore Failures
- **Issue**: Packages fail to install during restore
- **Solution**: Check network connectivity, verify package sources, check agent logs

#### Backup/Restore Issues
- **Issue**: Database restore fails
- **Solution**: Verify PostgreSQL version compatibility, check database permissions

#### Agent Download Issues
- **Issue**: Agent binary download fails
- **Solution**: Check GitHub releases accessibility, verify version tag exists

---

## Success Metrics

### Overall Success Criteria
- **Phase 1**: Blueprint capture accuracy > 95%
- **Phase 2**: Restore success rate > 90%
- **Phase 3**: Backup/restore data integrity 100%
- **Phase 4**: Agent installation success rate 100%

### Pass/Fail Thresholds
- **PASS**: All phases meet success criteria
- **FAIL**: Any phase fails with critical blocking issue
- **PARTIAL**: Non-critical issues that don't block production use

---

## Notes

- All tests should be executed in order (Phase 1 → Phase 2 → Phase 3 → Phase 4)
- Each phase must pass before proceeding to the next
- Document all failures and their resolutions
- Update this document with lessons learned
- Consider automating repetitive test steps
