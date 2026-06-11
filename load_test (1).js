import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// ─── Custom Metrics ───────────────────────────────────────────────
const loginDuration   = new Trend('login_duration_ms');
const bookingDuration = new Trend('booking_duration_ms');
const errorRate       = new Rate('error_rate');
const totalRequests   = new Counter('total_requests');

// ─── Credentials ──────────────────────────────────────────────────
const BASE_URL        = 'https://lambda-dev.mycoifeur.com.sa';

const USER_PHONE      = '123456786';
const USER_COUNTRY    = '966';
const USER_OTP        = '1234';

const PROVIDER_PHONE  = '123456879';
const PROVIDER_OTP    = '1234';

const ADMIN_USER      = 'admin@mycoifeur.com';
const ADMIN_PASS      = 'password';

// ─── Load Test Stages ─────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s', target: 5  },
    { duration: '1m',  target: 15 },
    { duration: '30s', target: 30 },
    { duration: '30s', target: 0  },
  ],
  thresholds: {
    http_req_duration:   ['p(95)<5000'],
    http_req_failed:     ['rate<0.10'],
    error_rate:          ['rate<0.10'],
    login_duration_ms:   ['p(95)<3000'],
    booking_duration_ms: ['p(95)<5000'],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────
const headers = (token = null) => {
  const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
};

function post(path, body, token = null) {
  totalRequests.add(1);
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers: headers(token) });
}

function get(path, token = null) {
  totalRequests.add(1);
  return http.get(`${BASE_URL}${path}`, { headers: headers(token) });
}

function parseToken(res) {
  try {
    const b = JSON.parse(res.body);
    return b?.data?.accessToken || b?.data?.token || b?.token || b?.data?.access_token || b?.access_token || null;
  } catch (_) { return null; }
}

function parseId(res, field = 'id') {
  try {
    const b = JSON.parse(res.body);
    return b?.data?.[field] || b?.data?.[0]?.[field] || b?.[field] || b?.[0]?.[field] || null;
  } catch (_) { return null; }
}

function ok(res, label) {
  const passed = check(res, {
    [`${label}: status 2xx`]: (r) => r.status >= 200 && r.status < 300,
  });
  errorRate.add(passed ? 0 : 1);
  return passed;
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO A: Guest Flow
// ════════════════════════════════════════════════════════════════════
function guestFlow() {
  group('Guest — Home & Discovery', () => {
    ok(get('/api/v1/guest/home'),                 'Guest Home');       sleep(0.5);
    ok(get('/api/v1/guest/categories'),           'Guest Categories'); sleep(0.5);
    ok(get('/api/v1/guest/salons'),               'Guest Salons');     sleep(0.5);
    ok(get('/api/v1/guest/salons/search?q=hair'), 'Guest Search');     sleep(0.5);
    ok(get('/api/v1/guest/services'),             'Guest Services');
  });
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO B: User Login
// ════════════════════════════════════════════════════════════════════
function userLogin() {
  let token = null;

  group('User — Send OTP', () => {
    const start = Date.now();
    const res = post('/api/v1/auth/send-otp', {
      phone:       USER_PHONE,
      countryCode: USER_COUNTRY,
      typeUser:    'user',
    });
    loginDuration.add(Date.now() - start);
    ok(res, 'User Send OTP');
  });

  sleep(1);

  group('User — Verify OTP', () => {
    const start = Date.now();
    const res = post('/api/v1/auth/verify-code', {
      phone:       USER_PHONE,
      code:        USER_OTP,
      typeUser:    'user',
      countryCode: USER_COUNTRY,
    });
    loginDuration.add(Date.now() - start);
    ok(res, 'User Verify OTP');
    token = parseToken(res);
  });

  return token;
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO C: User App Flow
// ════════════════════════════════════════════════════════════════════
function userAppFlow(token) {
  if (!token) return;

  group('User — Home & Notifications', () => {
    ok(get('/api/v1/home', token),               'User Home');          sleep(0.5);
    ok(get('/api/v1/user/notifications', token), 'User Notifications');
  });

  sleep(1);

  group('User — Browse Salons', () => {
    ok(get('/api/v1/salons', token),                    'Salons List');   sleep(0.5);
    ok(get('/api/v1/salons/search?q=hair', token),      'Salon Search');  sleep(0.5);
    ok(get('/api/v1/salons/search/filters', token),     'Search Filters');
  });

  sleep(1);

  let salonId = null;
  group('User — Salon Detail', () => {
    const res = get('/api/v1/salons', token);
    salonId = parseId(res);
    if (salonId) {
      ok(get(`/api/v1/salons/${salonId}`, token),              'Salon Detail');  sleep(0.5);
      ok(get(`/api/v1/salons/${salonId}/reviews`, token),      'Salon Reviews'); sleep(0.5);
      ok(get(`/api/v1/salons/${salonId}/working-days`, token), 'Working Days');
    }
  });

  sleep(1);

  group('User — Services & Categories', () => {
    ok(get('/api/v1/categories', token), 'Categories'); sleep(0.5);
    ok(get('/api/v1/services', token),   'Services');
  });

  sleep(1);

  group('User — Profile & Wallet', () => {
    ok(get('/api/v1/user/profile', token), 'My Profile'); sleep(0.5);
    ok(get('/api/v1/balance', token),      'Wallet');     sleep(0.5);
    ok(get('/api/v1/user/rewards', token), 'Rewards');
  });

  sleep(1);

  group('User — My Orders', () => {
    ok(get('/api/v1/orders/i', token), 'My Orders');
  });
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO D: Booking Flow
// ════════════════════════════════════════════════════════════════════
function bookingFlow(token) {
  if (!token) return;

  let serviceId = null;

  group('Booking — Get Service', () => {
    const res = get('/api/v1/services', token);
    serviceId = parseId(res);
  });

  if (!serviceId) return;
  sleep(1);

  group('Booking — Add to Cart', () => {
    const start = Date.now();
    ok(post('/api/v1/cart/add', { serviceId: serviceId }, token), 'Add to Cart');
    bookingDuration.add(Date.now() - start);
  });

  sleep(1);

  group('Booking — View Cart', () => {
    ok(get('/api/v1/cart/i', token), 'View Cart');
  });

  sleep(1);

  group('Booking — Choose Payment', () => {
    const start = Date.now();
    ok(post('/api/v1/cart/i/choose/payment', {
      paymentMethod: 'card',
      startTime:     '10:00',
      bookDate:      '2025-09-01',
      useWallet:     false,
    }, token), 'Choose Payment');
    bookingDuration.add(Date.now() - start);
  });

  sleep(1);

  group('Booking — Complete Order', () => {
    const start = Date.now();
    ok(post('/api/v1/cart/i/complet', {
      startTime:      '10:00',
      bookDate:       '2025-09-01',
      placeOfService: 'salon',
    }, token), 'Complete Booking');
    bookingDuration.add(Date.now() - start);
  });
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO E: Provider Login & Dashboard
// ════════════════════════════════════════════════════════════════════
function providerLogin() {
  let token = null;

  group('Provider — Send OTP', () => {
    const res = post('/api/v1/auth/send-otp', {
      phone:       PROVIDER_PHONE,
      countryCode: USER_COUNTRY,
      typeUser:    'user',
    });
    ok(res, 'Provider Send OTP');
  });

  sleep(1);

  group('Provider — Verify OTP', () => {
    const res = post('/api/v1/auth/verify-code', {
      phone:       PROVIDER_PHONE,
      code:        PROVIDER_OTP,
      typeUser:    'user',
      countryCode: USER_COUNTRY,
    });
    ok(res, 'Provider Verify OTP');
    token = parseToken(res);
  });

  return token;
}

function providerDashboard(token) {
  if (!token) return;

  group('Provider — Profile & Dashboard', () => {
    ok(get('/api/v1/salon/profile/profile', token),        'Provider Profile');   sleep(0.5);
    ok(get('/api/v1/salon/profile/dashboard', token),      'Provider Dashboard'); sleep(0.5);
    ok(get('/api/v1/salon/profile/income/summary', token), 'Income Summary');
  });

  sleep(1);

  group('Provider — Orders', () => {
    ok(get('/api/v1/salon/orders/i', token),          'Provider Orders');  sleep(0.5);
    ok(get('/api/v1/salon/orders/i/calendar', token), 'Order Calendar');
  });

  sleep(1);

  group('Provider — Services', () => {
    ok(get('/api/v1/salon/services', token),   'My Services');      sleep(0.5);
    ok(get('/api/v1/salon/categories', token), 'Salon Categories');
  });

  sleep(1);

  group('Provider — Availability', () => {
    ok(get('/api/v1/salon/availability', token),          'Availability');     sleep(0.5);
    ok(get('/api/v1/salon/availability/calendar', token), 'Avail Calendar');
  });

  sleep(1);

  group('Provider — Earnings & Wallet', () => {
    ok(get('/api/v1/provider/earnings', token),        'Earnings');       sleep(0.5);
    ok(get('/api/v1/provider/payouts/summary', token), 'Payout Summary'); sleep(0.5);
    ok(get('/api/v1/balance', token),                  'Provider Wallet');
  });

  sleep(1);

  group('Provider — Notifications', () => {
    ok(get('/api/v1/salon/notifications', token), 'Provider Notifications');
  });
}

// ════════════════════════════════════════════════════════════════════
// SCENARIO F: Admin Login & Dashboard
// ════════════════════════════════════════════════════════════════════
function adminLogin() {
  let token = null;

  group('Admin — Login', () => {
    const start = Date.now();
    const res = post('/api/v1/auth/admin/login', {
      user:     ADMIN_USER,
      password: ADMIN_PASS,
    });
    loginDuration.add(Date.now() - start);
    ok(res, 'Admin Login');
    token = parseToken(res);
  });

  return token;
}

function adminDashboard(token) {
  if (!token) return;

  group('Admin — Overview', () => {
    ok(get('/api/v1/web/admin/overview', token),                'Overview');       sleep(0.5);
    ok(get('/api/v1/web/admin/overview/calendar', token),       'Admin Calendar'); sleep(0.5);
    ok(get('/api/v1/web/admin/overview/orders-statics', token), 'Order Stats');
  });

  sleep(1);

  group('Admin — Users & Salons', () => {
    ok(get('/api/v1/web/admin/users', token),       'Users List');  sleep(0.5);
    ok(get('/api/v1/web/admin/salons', token),      'Salons List'); sleep(0.5);
    ok(get('/api/v1/web/admin/users/count', token), 'User Count');
  });

  sleep(1);

  group('Admin — Orders', () => {
    ok(get('/api/v1/web/admin/orders', token),         'All Orders');     sleep(0.5);
    ok(get('/api/v1/web/admin/orders/pending', token), 'Pending Orders');
  });

  sleep(1);

  group('Admin — Reports', () => {
    ok(get('/api/v1/web/admin/reports/sales/overview', token),   'Sales Overview'); sleep(0.5);
    ok(get('/api/v1/web/admin/reports/sales/statistics', token), 'Sales Stats');
  });

  sleep(1);

  group('Admin — Payments & Wallet', () => {
    ok(get('/api/v1/web/admin/payments', token),        'Payments');       sleep(0.5);
    ok(get('/api/v1/web/admin/wallet/balances', token), 'Wallet Balances');
  });
}

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════
export default function () {
  const vuIndex = __VU % 3;

  if (vuIndex === 0) {
    guestFlow();
    sleep(1);
    const userToken = userLogin();
    sleep(1);
    userAppFlow(userToken);
    sleep(1);
    bookingFlow(userToken);

  } else if (vuIndex === 1) {
    const providerToken = providerLogin();
    sleep(1);
    providerDashboard(providerToken);

  } else {
    const adminToken = adminLogin();
    sleep(1);
    adminDashboard(adminToken);
  }

  sleep(2);
}

// ─── Summary ──────────────────────────────────────────────────────
export function handleSummary(data) {
  return {
    'stdout':                 textSummary(data, { indent: ' ', enableColors: true }),
    'load_test_summary.json': JSON.stringify(data, null, 2),
  };
}
