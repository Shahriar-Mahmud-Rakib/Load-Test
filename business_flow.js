import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

// ─── Custom Metrics ───────────────────────────────────────────────
const errorRate = new Rate('errors');
const providerLoginDuration = new Trend('duration_provider_login');
const providerProfileDuration = new Trend('duration_provider_profile');
const adminLoginDuration = new Trend('duration_admin_login');
const adminApproveDuration = new Trend('duration_admin_approve');
const providerServiceDuration = new Trend('duration_provider_add_service');
const providerScheduleDuration = new Trend('duration_provider_schedule');
const userLoginDuration = new Trend('duration_user_login');
const userBookingDuration = new Trend('duration_user_booking');
const userPaymentDuration = new Trend('duration_user_payment');

// ─── Config ───────────────────────────────────────────────────────
const BASE_URL = 'https://lambda-dev.mycoifeur.com.sa/api/v1';
const OTP_CODE = '1234';
const ADMIN_EMAIL = 'amrmuhamed9@gmail.com';
const ADMIN_PASS = '123456';
const COUNTRY = '966';

// Test card
const TEST_CARD = {
    number: '5123450000000005',
    expiry: '01/39',
    cvv: '100'
};

export const options = {
    stages: [
        { duration: '30s', target: 10 }, // Ramp up to 10 VUs
        { duration: '1m', target: 50 },  // Hold at 50 VUs for 1 minute
        { duration: '30s', target: 0 },  // Ramp down to 0 VUs
    ],
    thresholds: {
        http_req_failed: ['rate<0.05'],
    },
};

export function handleSummary(data) {
  return {
    "report.html": htmlReport(data),
  };
}

export default function () {
    // Generate dynamic phone for this VU/iteration to avoid conflicts
    const randomSuffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const providerPhone = `900${randomSuffix}`;
    const userPhone = `800${randomSuffix}`;

    // ==========================================
    // PHASE 1: PROVIDER LOGIN & PROFILE CREATION
    // ==========================================
    const providerPayload = { phone: providerPhone, countryCode: COUNTRY, typeUser: 'company' };
    
    // OTP
    let res = http.post(`${BASE_URL}/auth/send-otp`, JSON.stringify(providerPayload), { headers: { 'Content-Type': 'application/json' } });
    console.log("OTP Send:", res.status, res.body);
    providerLoginDuration.add(res.timings.duration);
    
    res = http.post(`${BASE_URL}/auth/verify-code`, JSON.stringify({ ...providerPayload, code: OTP_CODE }), { headers: { 'Content-Type': 'application/json' } });
    console.log("OTP Verify:", res.status, res.body);
    providerLoginDuration.add(res.timings.duration);
    check(res, { 'Provider logged in': (r) => r.status === 200 || r.status === 201 });
    
    let providerToken = res.json('data.accessToken') || res.json('data.token');
    let providerId = res.json('data.user.id');
    
    if (!providerToken) {
        errorRate.add(1);
        return;
    }
    const providerAuth = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${providerToken}` };

    // Profile Creation
    // (Mocking the exact payload based on standard structure for individual/company, image, etc.)
    res = http.patch(`${BASE_URL}/user/salon-profile`, JSON.stringify({
        fullName: `Provider ${providerPhone}`,
        email: `provider${providerPhone}@test.com`,
        city: 30,
        bio: 'Test Location'
    }), { headers: providerAuth });
    providerProfileDuration.add(res.timings.duration);
    check(res, { 'Provider profile created': (r) => r.status === 200 || r.status === 201 });
    sleep(1);

    // Admin approval no longer required for typeUser: company

    // ==========================================
    // PHASE 3: PROVIDER ADD SERVICE & SCHEDULE
    // ==========================================
    // Add Service
    res = http.post(`${BASE_URL}/salon/services/create`, JSON.stringify({
        title_en: 'Premium Haircut', title_ar: 'قصة شعر مميزة',
        content_en: 'Premium haircut service', content_ar: 'خدمة قص الشعر',
        price_first: '150', category_id: '1', time: '00:30:00', status: 'show'
    }), { headers: providerAuth });
    providerServiceDuration.add(res.timings.duration);
    check(res, { 'Service created': (r) => r.status === 200 || r.status === 201 });
    
    let serviceId = res.json('data.id') || 1; // fallback to 1 if not returned

    // Add Schedule / Working Days
    res = http.put(`${BASE_URL}/salon/profile/working-days`, JSON.stringify({
        working_days: [
            { day: 'monday', from: '09:00', to: '18:00' },
            { day: 'tuesday', from: '09:00', to: '18:00' }
        ]
    }), { headers: providerAuth });
    providerScheduleDuration.add(res.timings.duration);
    check(res, { 'Schedule added': (r) => r.status === 200 || r.status === 201 });
    sleep(1);

    // ==========================================
    // PHASE 4: USER LOGIN & BOOKING
    // ==========================================
    const userPayload = { phone: userPhone, countryCode: COUNTRY, typeUser: 'user' };
    
    // User OTP
    res = http.post(`${BASE_URL}/auth/send-otp`, JSON.stringify(userPayload), { headers: { 'Content-Type': 'application/json' } });
    res = http.post(`${BASE_URL}/auth/verify-code`, JSON.stringify({ ...userPayload, code: OTP_CODE }), { headers: { 'Content-Type': 'application/json' } });
    userLoginDuration.add(res.timings.duration);
    check(res, { 'User logged in': (r) => r.status === 200 || r.status === 201 });
    
    let userToken = res.json('data.accessToken') || res.json('data.token');
    if (!userToken) return;
    const userAuth = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` };

    // Search Category & Add to Cart
    res = http.post(`${BASE_URL}/cart/add`, JSON.stringify({ serviceId }), { headers: userAuth });
    userBookingDuration.add(res.timings.duration);
    check(res, { 'Service added to user cart': (r) => r.status === 200 || r.status === 201 });
    sleep(1);

    // Complete Booking
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const bookDateStr = tomorrow.toISOString().split('T')[0];
    
    res = http.post(`${BASE_URL}/cart/i/complet`, JSON.stringify({
        startTime: "10:00:00", // Needs to match schedule
        bookDate: bookDateStr,
        placeOfService: "salon",
        addressId: 1,
        note: "Test booking note"
    }), { headers: userAuth });
    userBookingDuration.add(res.timings.duration);
    check(res, { 'Booking details added': (r) => r.status === 200 || r.status === 201 });
    sleep(1);

    // Card Payment
    res = http.post(`${BASE_URL}/cart/i/choose/payment`, JSON.stringify({
        paymentMethod: "card",
        startTime: "10:00:00",
        bookDate: bookDateStr,
        useWallet: false,
        card: TEST_CARD // Depending on Tap / gateway integration
    }), { headers: userAuth });
    userPaymentDuration.add(res.timings.duration);
    check(res, { 'Payment completed': (r) => r.status === 200 || r.status === 201 });

    // Track Booking
    res = http.get(`${BASE_URL}/orders/i`, { headers: userAuth });
    check(res, { 'Track orders': (r) => r.status === 200 });
    sleep(1);

    // ==========================================
    // PHASE 5: PROVIDER ORDER MANAGEMENT
    // ==========================================
    res = http.get(`${BASE_URL}/salon/orders/i`, { headers: providerAuth });
    check(res, { 'Provider fetched orders': (r) => r.status === 200 });
    
    // Attempt to accept the first pending order
    const providerOrders = res.json('data.data') || [];
    if (providerOrders.length > 0) {
        const orderId = providerOrders[0].id;
        
        // Accept Order
        res = http.patch(`${BASE_URL}/salon/orders/${orderId}/artist_accept`, JSON.stringify({}), { headers: providerAuth });
        check(res, { 'Provider accepted order': (r) => r.status === 200 || r.status === 201 });
    }
}
