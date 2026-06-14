import http from 'k6/http';
import { check, sleep } from 'k6';
import { vu } from 'k6/execution';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Custom Metrics ───────────────────────────────────────────────
const loginSuccess = new Rate('login_success');
const cartSuccess = new Rate('cart_success');
const paymentSuccess = new Rate('payment_success');
const webhookSuccess = new Rate('webhook_success');
const bookingSuccess = new Rate('booking_success');
const orderSuccess = new Rate('order_success');
const stepDuration = new Trend('step_duration');
const failedIterations = new Counter('failed_iterations');

// ─── Config ───────────────────────────────────────────────────────
const BASE_URL = 'https://lambda-dev.mycoifeur.com.sa/api/v1';
const OTP_CODE = '1234';
const COUNTRY = '966';
const PHONE_POOL = Array.from({ length: 1000 }, (_, i) =>
    `500${String(i).padStart(6, '0')}`,
);

// ─── Load Stages ──────────────────────────────────────────────────
export const options = {
    stages: [
        { duration: '30s', target: 1 },
        { duration: '1m', target: 1 },
        { duration: '15s', target: 0 },
    ],
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<5000'],
        login_success: ['rate>0.95'],
        cart_success: ['rate>0.90'],
        payment_success: ['rate>0.90'],
        webhook_success: ['rate>0.90'],
        booking_success: ['rate>0.90'],
        order_success: ['rate>0.90'],
    },
};
export function handleSummary(data) {
    return { 'report.html': htmlReport(data) };
}

// ─── Helpers ──────────────────────────────────────────────────────
const jsonHeaders = { 'Content-Type': 'application/json' };
function authHeaders(token) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}
function to24h(timeStr) {
    const isPm = timeStr.toLowerCase().includes('pm');
    const clean = timeStr.replace(/ am| pm/gi, '').trim();
    const parts = clean.split(':');
    let h = parseInt(parts[0]);
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${parts[1]}:00`;
}
// ── FIX 1: id as string, amount as float ──────────────────────────
function tapWebhookPayload(phone, chargeId, amount) {
    const chargeIdStr = String(chargeId);
    const amountFloat = parseFloat(String(amount));
    return {
        id: chargeIdStr,
        status: 'CAPTURED',
        amount: amountFloat,
        currency: 'SAR',
        live_mode: false,
        object: 'charge',
        transaction: {
            timezone: 'UTC+03:00',
            created: String(Date.now()),
            amount: amountFloat,
            currency: 'SAR',
        },
        reference: {
            track: `tck_${chargeIdStr}`,
            payment: `pay_${chargeIdStr}`,
            gateway: `gw_${chargeIdStr}`,
            transaction: `txn_${chargeIdStr}`,
            order: `ord_${chargeIdStr}`,
        },
        response: { code: '000', message: 'Approved' },
        card: {
            id: `card_${chargeIdStr}`,
            first_six: '411111',
            scheme: 'VISA',
            brand: 'VISA',
            last_four: '1111',
        },
        customer: {
            id: `cus_${chargeIdStr}`,
            first_name: 'Test',
            last_name: 'User',
            email: `user_${phone}@test.com`,
            phone: { country_code: COUNTRY, number: phone },
        },
        redirect: { status: 'SUCCESS', url: 'https://mycoifeur.com.sa/success' },
        post: { status: 'PENDING', url: 'https://mycoifeur.com.sa/webhook' },
    };
}
// ── FIX 2: try multiple future dates to find available slots ──────
function findAvailableSlots(ah, serviceId, vuId, iter) {
    for (let daysAhead = 1; daysAhead <= 7; daysAhead++) {
        const d = new Date();
        d.setDate(d.getDate() + daysAhead);
        const dateStr = d.toISOString().split('T')[0];
        const timesRes = http.get(
            `${BASE_URL}/cart/available_times?date=${dateStr}&serviceId=${serviceId}`,
            { headers: ah, timeout: '10s' },
        );
        if (timesRes.status !== 200) continue;
        const allSlots = timesRes.json('data') || [];
        const availableSlots = allSlots.filter((s) => s.available === true);
        if (availableSlots.length > 0) {
            const slot = availableSlots[(vuId + iter) % availableSlots.length];
            return { dateStr, slot };
        }
    }
    return null;
}
// ─── Main Flow ────────────────────────────────────────────────────
export default function () {
    const phone = PHONE_POOL[(__VU - 1) % PHONE_POOL.length];
    const vuId = vu.idInTest || 1;
    const iter = vu.iterationInInstance || 0;
    // ── Step 1: Send OTP ──────────────────────────────────────────
    let t = Date.now();
    const otpRes = http.post(
        `${BASE_URL}/auth/send-otp`,
        JSON.stringify({ phone, countryCode: COUNTRY, typeUser: 'user' }),
        { headers: jsonHeaders, timeout: '10s' },
    );
    stepDuration.add(Date.now() - t, { step: 'send_otp' });
    const otpOk = check(otpRes, {
        'send-otp: 200/201': (r) => r.status === 200 || r.status === 201,
        'send-otp: success': (r) => {
            try { return JSON.parse(r.body).success === true; } catch { return false; }
        },
    });
    if (!otpOk) {
        console.error(`[${phone}] send-otp failed → ${otpRes.status}: ${otpRes.body}`);
        loginSuccess.add(false);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    sleep(1);
    // ── Step 2: Verify OTP ────────────────────────────────────────
    t = Date.now();
    const verifyRes = http.post(
        `${BASE_URL}/auth/verify-code`,
        JSON.stringify({ phone, code: OTP_CODE, typeUser: 'user', countryCode: COUNTRY }),
        { headers: jsonHeaders, timeout: '10s' },
    );
    stepDuration.add(Date.now() - t, { step: 'verify_otp' });
    const token = verifyRes.json('data.accessToken') || verifyRes.json('data.token');
    const loginOk = check(verifyRes, {
        'verify-code: 200/201': (r) => r.status === 200 || r.status === 201,
        'verify-code: has token': () => !!token,
    });
    loginSuccess.add(loginOk);
    if (!loginOk) {
        console.error(`[${phone}] verify-code failed → ${verifyRes.status}: ${verifyRes.body}`);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    const ah = authHeaders(token);
    sleep(2); // FIX 3: longer sleep to reduce DB pressure
    // ── Step 3: Search salons ──────────────────────────────────────
    t = Date.now();
    const salonsRes = http.get(
        `${BASE_URL}/salons/search`,
        { headers: ah, timeout: '10s' },
    );
    stepDuration.add(Date.now() - t, { step: 'search_salons' });
    check(salonsRes, { 'salons/search: 200': (r) => r.status === 200 });
    let providersList = [];
    try { providersList = salonsRes.json('data.data') || []; } catch { }
    if (providersList.length === 0) {
        console.warn(`[${phone}] no salons found`);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    // ── Step 4: Find a service ─────────────────────────────────────
    let serviceId = null;
    for (let i = 0; i < providersList.length; i++) {
        const pid = providersList[i].id;
        const svcRes = http.get(
            `${BASE_URL}/services?salonId=${pid}`,
            { headers: ah, timeout: '10s' },
        );
        try {
            const svcList = svcRes.json('data.data') || [];
            if (svcList.length > 0) { serviceId = svcList[0].id; break; }
        } catch { }
    }
    if (!serviceId) {
        console.warn(`[${phone}] no services found`);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    sleep(2); // FIX 3: reduce DB pressure
    // ── Step 5: Add to cart ────────────────────────────────────────
    t = Date.now();
    const cartRes = http.post(
        `${BASE_URL}/cart/add`,
        JSON.stringify({ serviceId }),
        { headers: ah, timeout: '15s' },
    );
    stepDuration.add(Date.now() - t, { step: 'add_to_cart' });
    const cartOk = check(cartRes, {
        'cart/add: 200/201': (r) => r.status === 200 || r.status === 201,
    });
    cartSuccess.add(cartOk);
    if (!cartOk) {
        console.error(`[${phone}] cart/add failed → ${cartRes.status}: ${cartRes.body}`);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    sleep(2);
    // ── Step 6: Find available slot across next 7 days ────────────
    const found = findAvailableSlots(ah, serviceId, vuId, iter);
    if (!found) {
        console.warn(`[${phone}] no available slots in next 7 days`);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    const { dateStr: bookDateStr, slot } = found;
    const startTime24 = to24h(slot.time);
    console.log(`[${phone}] booking on ${bookDateStr} at ${startTime24}`);
    sleep(2);
    // ── Step 7: Choose payment (card) ─────────────────────────────
    t = Date.now();
    const payRes = http.post(
        `${BASE_URL}/cart/i/choose/payment`,
        JSON.stringify({
            startTime: startTime24,
            bookDate: bookDateStr,
            useWallet: false,
            paymentMethod: 'card',
        }),
        { headers: ah, timeout: '10s' },
    );
    stepDuration.add(Date.now() - t, { step: 'choose_payment' });
    const payOk = check(payRes, {
        'choose/payment: 200/201': (r) => r.status === 200 || r.status === 201,
    });
    paymentSuccess.add(payOk);
    if (!payOk) {
        console.error(`[${phone}] choose/payment failed → ${payRes.status}: ${payRes.body}`);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    // FIX 1: extract chargeId as string, amount as float
    let chargeId, orderAmount;
    try {
        const payBody = payRes.json();
        chargeId = String(
            payBody?.data?.chargeId
            || payBody?.data?.charge_id
            || payBody?.data?.id
            || `chg_LOAD_${Date.now()}_${vuId}`
        );
        orderAmount = parseFloat(
            payBody?.data?.amount
            || payBody?.data?.totalAmount
            || payBody?.data?.total
            || payBody?.data?.price
            || 100
        );
    } catch {
        chargeId = `chg_LOAD_${Date.now()}_${vuId}`;
        orderAmount = 100.00;
    }
    console.log(`[${phone}] chargeId=${chargeId} (type=${typeof chargeId}) amount=${orderAmount} (type=${typeof orderAmount})`);
    sleep(2);
    // ── Step 8: Tap webhook ────────────────────────────────────────
    t = Date.now();
    const webhookRes = http.post(
        `${BASE_URL}/tap/callback`,
        JSON.stringify(tapWebhookPayload(phone, chargeId, orderAmount)),
        { headers: jsonHeaders, timeout: '10s' },
    );
    stepDuration.add(Date.now() - t, { step: 'tap_webhook' });
    const webhookOk = check(webhookRes, {
        'tap/callback: 200/201': (r) => r.status === 200 || r.status === 201,
    });
    webhookSuccess.add(webhookOk);
    if (!webhookOk) {
        console.error(`[${phone}] tap/callback failed → ${webhookRes.status}: ${webhookRes.body}`);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    sleep(2);
    // ── Step 9: Complete booking ───────────────────────────────────
    t = Date.now();
    const completeRes = http.post(
        `${BASE_URL}/cart/i/complet`,
        JSON.stringify({
            startTime: startTime24,
            bookDate: bookDateStr,
            placeOfService: 'salon',
            addressId: 1,
            note: 'Load test booking',
        }),
        { headers: ah, timeout: '15s' },
    );
    stepDuration.add(Date.now() - t, { step: 'complete_booking' });
    const bookingOk = check(completeRes, {
        'cart/complet: 200/201': (r) => r.status === 200 || r.status === 201,
    });
    bookingSuccess.add(bookingOk);
    if (!bookingOk) {
        console.error(`[${phone}] cart/complet failed → ${completeRes.status}: ${completeRes.body}`);
        failedIterations.add(1);
        sleep(3);
        return;
    }
    sleep(2);
    // ── Step 10: View orders ───────────────────────────────────────
    t = Date.now();
    const ordersRes = http.get(
        `${BASE_URL}/orders/i`,
        { headers: ah, timeout: '10s' },
    );
    stepDuration.add(Date.now() - t, { step: 'view_orders' });
    const orderOk = check(ordersRes, {
        'orders/i: 200': (r) => r.status === 200,
    });
    orderSuccess.add(orderOk);
    if (!orderOk) {
        console.error(`[${phone}] orders/i failed → ${ordersRes.status}: ${ordersRes.body}`);
        failedIterations.add(1);
    }
    sleep(3); // FIX 3: cool down between iterations
}
