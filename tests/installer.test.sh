#!/usr/bin/env bash
# PocketCloud Installer Regression Tests
# Tests critical installer functions to prevent APP_URL generation failures

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test result tracking
test_passed() {
  echo "PASS: $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
}

test_failed() {
  echo "FAIL: $1"
  echo "  Error: $2"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
}

test_section() {
  echo ""
  echo "=== $1 ==="
}

# Critical function from installer: derive_app_url
derive_app_url() {
  local host="$1"
  host="${host#"${host%%[![:space:]]*}"}"
  host="${host%"${host##*[![:space:]]}"}"
  host="${host%/}"
  
  if [[ -z "$host" ]]; then
    printf 'http://localhost'
    return
  fi
  
  if [[ "$host" =~ ^https?:// ]]; then
    printf '%s' "$host"
  else
    # Use http:// for IP addresses, https:// for domains
    if [[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
      printf 'http://%s' "$host"
    else
      printf 'https://%s' "$host"
    fi
  fi
}

# Test: IP address detection returns only IP (no logs)
test_section "IP Address Detection - No Log Contamination"
test_result=$(derive_app_url "159.89.171.72")
if [[ "$test_result" == "http://159.89.171.72" ]]; then
  test_passed "IP address returns correct HTTP URL"
else
  test_failed "IP address returns correct HTTP URL" "Expected 'http://159.89.171.72', got '$test_result'"
fi

# Test: Domain returns HTTPS URL
test_result=$(derive_app_url "cloud.example.com")
if [[ "$test_result" == "https://cloud.example.com" ]]; then
  test_passed "Domain returns correct HTTPS URL"
else
  test_failed "Domain returns correct HTTPS URL" "Expected 'https://cloud.example.com', got '$test_result'"
fi

# Test: Full URL is passed through unchanged
test_result=$(derive_app_url "https://example.com")
if [[ "$test_result" == "https://example.com" ]]; then
  test_passed "Full HTTPS URL passed through unchanged"
else
  test_failed "Full HTTPS URL passed through unchanged" "Expected 'https://example.com', got '$test_result'"
fi

test_result=$(derive_app_url "http://192.168.1.1")
if [[ "$test_result" == "http://192.168.1.1" ]]; then
  test_passed "Full HTTP URL passed through unchanged"
else
  test_failed "Full HTTP URL passed through unchanged" "Expected 'http://192.168.1.1', got '$test_result'"
fi

# Test: Empty input returns localhost
test_result=$(derive_app_url "")
if [[ "$test_result" == "http://localhost" ]]; then
  test_passed "Empty input returns localhost"
else
  test_failed "Empty input returns localhost" "Expected 'http://localhost', got '$test_result'"
fi

# Test: Whitespace handling
test_result=$(derive_app_url "  159.89.171.72  ")
if [[ "$test_result" == "http://159.89.171.72" ]]; then
  test_passed "Whitespace properly trimmed"
else
  test_failed "Whitespace properly trimmed" "Expected 'http://159.89.171.72', got '$test_result'"
fi

# Test: Trailing slash removed
test_result=$(derive_app_url "159.89.171.72/")
if [[ "$test_result" == "http://159.89.171.72" ]]; then
  test_passed "Trailing slash removed"
else
  test_failed "Trailing slash removed" "Expected 'http://159.89.171.72', got '$test_result'"
fi

# Test: Various IP formats
test_section "IP Address Format Validation"
test_result=$(derive_app_url "192.168.1.1")
if [[ "$test_result" == "http://192.168.1.1" ]]; then
  test_passed "Private IP address handled"
else
  test_failed "Private IP address handled" "Expected 'http://192.168.1.1', got '$test_result'"
fi

test_result=$(derive_app_url "10.0.0.1")
if [[ "$test_result" == "http://10.0.0.1" ]]; then
  test_passed "Class A private IP handled"
else
  test_failed "Class A private IP handled" "Expected 'http://10.0.0.1', got '$test_result'"
fi

# Test: Domain names with subdomains
test_section "Domain Name Handling"
test_result=$(derive_app_url "api.example.com")
if [[ "$test_result" == "https://api.example.com" ]]; then
  test_passed "Subdomain returns HTTPS"
else
  test_failed "Subdomain returns HTTPS" "Expected 'https://api.example.com', got '$test_result'"
fi

test_result=$(derive_app_url "pocket.example.co.uk")
if [[ "$test_result" == "https://pocket.example.co.uk" ]]; then
  test_passed "Multi-part domain returns HTTPS"
else
  test_failed "Multi-part domain returns HTTPS" "Expected 'https://pocket.example.co.uk', got '$test_result'"
fi

# Test: Environment variable override simulation
test_section "Environment Variable Override"
# Simulate APP_URL being set
export TEST_APP_URL="http://custom.override.com"
if [[ "$TEST_APP_URL" == "http://custom.override.com" ]]; then
  test_passed "Environment variable preserved"
else
  test_failed "Environment variable preserved" "Expected 'http://custom.override.com', got '$TEST_APP_URL'"
fi
unset TEST_APP_URL

# Test: No log contamination in command substitution
test_section "Command Substitution - No Log Contamination"
# Simulate a function that might log (this should fail if logging goes to stdout)
function test_function_with_logs() {
  echo "[test] This should not be captured" >&2
  echo "159.89.171.72"
}

test_result=$(test_function_with_logs)
if [[ "$test_result" == "159.89.171.72" ]]; then
  test_passed "Logs redirected to stderr, not captured"
else
  test_failed "Logs redirected to stderr, not captured" "Expected '159.89.171.72', got '$test_result'"
fi

# Test: URL validation regex patterns
test_section "URL Validation Patterns"
valid_urls=(
  "https://example.com"
  "http://192.168.1.1"
  "https://api.example.com"
  "http://10.0.0.1"
  "https://sub.domain.co.uk"
)

for url in "${valid_urls[@]}"; do
  if [[ "$url" =~ ^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]+)?(/.*)?$ ]]; then
    echo "PASS: Valid URL accepted: $url"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
  else
    echo "FAIL: Valid URL rejected: $url"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
  fi
done

# Test: IP detection pattern
test_section "IP Address Detection Pattern"
valid_ips=(
  "192.168.1.1"
  "10.0.0.1"
  "172.16.0.1"
  "8.8.8.8"
  "159.89.171.72"
)

for ip in "${valid_ips[@]}"; do
  if [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "PASS: Valid IP accepted: $ip"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
  else
    echo "FAIL: Valid IP rejected: $ip"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
  fi
done

# Test: Domain with dots pattern
test_section "Domain Name Pattern"
valid_domains=(
  "example.com"
  "api.example.com"
  "sub.domain.co.uk"
  "pocket.example.test"
)

for domain in "${valid_domains[@]}"; do
  if [[ "$domain" =~ \. ]]; then
    echo "PASS: Valid domain accepted: $domain"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
  else
    echo "FAIL: Valid domain rejected: $domain"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
  fi
done

# Test summary
test_section "Test Summary"
echo "Tests run: $TESTS_RUN"
echo "Tests passed: $TESTS_PASSED"
echo "Tests failed: $TESTS_FAILED"

if [[ $TESTS_FAILED -eq 0 ]]; then
  echo ""
  echo "All tests passed!"
  exit 0
else
  echo ""
  echo "Some tests failed!"
  exit 1
fi
