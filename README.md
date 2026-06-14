# 🚀 MyCoifeur Load Testing Suite

A comprehensive API load testing suite built with **k6**, covering the full business lifecycle of the MyCoifeur platform — from provider registration to user booking and payment.

---

## 📁 Project Structure

```
Load-Test/
├── login.js              # Standalone user login load test
├── booking.js            # Full user booking flow (login → payment)
├── provider_account.js   # Provider registration + admin approval flow
├── provider_service.js   # Provider service & schedule setup flow
├── business_flow.js      # Complete End-to-End flow (all roles combined)
├── README.md             # This file
└── report.html           # Auto-generated HTML report after each run
```

---

## 🧠 What Are We Testing & Why?

**Goal:** Measure how well the MyCoifeur API server performs under concurrent user load — identifying bottlenecks, slow endpoints, and failure rates before they affect real users.

**What we get:**
- Response time for every API endpoint
- Success & failure rates under concurrent load
- Server throughput (requests per second)
- Performance degradation thresholds

---

## 📋 What Each File Does

### 1️⃣ `login.js` — User Login Test
**Flow:**
```
Send OTP → Verify OTP → Receive Access Token
```
**Tests:** How fast and reliably the authentication system handles multiple concurrent logins.

---

### 2️⃣ `booking.js` — User Booking Flow Test
**Flow:**
```
Login
  → Fetch Categories
  → Search Providers
  → Find Provider with Real Services
  → Fetch Real Available Time Slots (from API)
  → Add Service to Cart
  → Complete Booking (address + time)
  → Card Payment (Test Card)
  → Track Order
```
**Tests:** The complete booking journey end-to-end under load.

> **💡 Smart Features:**
> - Automatically finds a provider that actually has services (no hardcoded IDs)
> - Fetches real available time slots from the API to avoid booking conflicts
> - Each Virtual User picks a different time slot to prevent 409 collisions

---

### 3️⃣ `provider_account.js` — Provider Account Test
**Flow:**
```
Provider Registration (OTP)
  → Create Profile (Individual/Company details)
  → Admin Login
  → Admin Approves Provider
```
**Tests:** Provider onboarding and admin approval pipeline under load.

---

### 4️⃣ `provider_service.js` — Provider Service Setup Test
**Flow:**
```
Provider Login (existing account)
  → Create Service (name, price, category, duration)
  → Set Working Days & Time Schedule
```
**Tests:** How the provider service management APIs handle concurrent requests.

---

### 5️⃣ `business_flow.js` — Complete End-to-End Test
**Flow:**
```
Phase 1: Provider Login + Profile Creation
Phase 2: Admin Login + Provider Approval
Phase 3: Provider adds Service + Sets Schedule
Phase 4: User Login + Booking + Payment
Phase 5: Provider views Order List + Accepts Order
```
**Tests:** The entire platform ecosystem working together simultaneously.

---

## ▶️ Run Commands

### Run Individual Tests

```bash
# Login flow only
k6 run login.js

# User booking flow only
k6 run booking.js

# Provider account creation flow only
k6 run provider_account.js

# Provider service setup flow only
k6 run provider_service.js

# Complete end-to-end business flow
k6 run business_flow.js
```

### Run with Custom Load (users & duration)

```bash
# 10 users, 20 total iterations
k6 run booking.js --iterations 20 --vus 10

# 50 concurrent users for 2 minutes
k6 run login.js --vus 50 --duration 2m

# 100 users for 5 minutes
k6 run business_flow.js --vus 100 --duration 5m
```

### Run All Tests Sequentially

```bash
k6 run login.js && \
k6 run booking.js && \
k6 run provider_account.js && \
k6 run provider_service.js && \
k6 run business_flow.js
```

---

## 📊 View the Report

After every test run, `report.html` is automatically created/overwritten. Open it with:

```bash
google-chrome report.html
```

Or manually open the file in any browser:
```
file:///media/smrakib/New Volume/Sofof/Load-Test/report.html
```

> ⚠️ **Note:** Each new test run **replaces** the previous `report.html` with fresh results.

---

## 📈 How to Read the Report

### Top 4 Summary Cards

| Card | What It Means |
|---|---|
| **Total Requests** | Total number of HTTP API calls made during the test |
| **Failed Requests** | Number of calls that returned 4xx or 5xx errors |
| **Breached Thresholds** | Whether any performance limit was exceeded |
| **Failed Checks** | Number of assertion checks that failed |

---

### Detailed Metrics Tab — Performance Table

| Metric | What It Means | Good Value |
|---|---|---|
| `http_req_duration` | Total time for a full API request cycle | < 500ms |
| `http_req_waiting` | Time the server took to process the request | < 400ms |
| `http_req_connecting` | Time spent establishing network connection | < 100ms |
| `http_req_tls_handshaking` | Time spent on SSL/TLS handshake | < 150ms |
| `iteration_duration` | Total time to complete one full user flow | Varies |
| `http_req_failed` | Percentage of requests that failed | < 5% |

---

### Understanding the Columns

| Column | Full Name | What It Means |
|---|---|---|
| **AVG** | Average | Mean response time across all requests |
| **MIN** | Minimum | Fastest single response received |
| **MED** | Median | The middle value — 50% of requests were faster |
| **MAX** | Maximum | Slowest single response received |
| **P(90)** | 90th Percentile | 90% of requests completed within this time |
| **P(95)** | 95th Percentile | 95% of requests completed within this time |

> **💡 Example:** `P(95) = 587ms` means 95 out of every 100 users got a response within 587ms.

---

### Checks & Groups Tab

Shows pass/fail results for each assertion in the script. For example:
- ✅ `User logged in` → 10/10 passed
- ✅ `Service added to cart` → 10/10 passed
- ✅ `Payment completed` → 10/10 passed

---

## ⚙️ Load Stage Configuration (per script)

### `login.js`
```
0s → 30s:  Ramp up to 20 Virtual Users
30s → 90s: Hold at 50 Virtual Users
90s → 2m:  Ramp down to 0
```

### `booking.js`
```
0s → 30s:  Ramp up to 5 Virtual Users
30s → 90s: Hold at 20 Virtual Users
90s → 2m:  Ramp down to 0
```

### `business_flow.js`
```
0s → 30s:  Ramp up to 10 Virtual Users
30s → 90s: Hold at 50 Virtual Users
90s → 2m:  Ramp down to 0
```

**VU (Virtual User)** = A simulated concurrent user executing the full test flow.

---

## 🔑 Test Credentials

| Role | Phone / Email | OTP / Password |
|---|---|---|
| User | Dynamic (800xxxxxx) | OTP: `1234` |
| Provider | Dynamic (900xxxxxx) | OTP: `1234` |
| Admin | `amrmuhamed9@gmail.com` | `123456` |
| Test Card | `5123450000000005` | CVV: `100`, Expiry: `01/39` |

> Dynamic phones are auto-generated per Virtual User to avoid conflicts during load testing.

---

## ✅ Signs of a Healthy Test Result

| Indicator | Expected |
|---|---|
| Exit code | `0` ✅ |
| Failed Requests | `0` ✅ |
| Breached Thresholds | `0` ✅ |
| `http_req_duration` AVG | `< 1000ms` ✅ |
| `http_req_failed` rate | `< 5%` ✅ |
| All checks passed | `100%` ✅ |

---

## 🛠️ Prerequisites

Make sure `k6` is installed:

```bash
# Check if installed
k6 version

# Install on Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

---

*Built with [k6](https://k6.io/) | Report powered by [k6-reporter](https://github.com/benc-uk/k6-reporter)*
