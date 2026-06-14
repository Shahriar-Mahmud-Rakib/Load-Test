import http from 'k6/http';
import { check, sleep } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

const BASE_URL = 'https://lambda-dev.mycoifeur.com.sa/api/v1';
const OTP_CODE = '1234';
const ADMIN_EMAIL = 'amrmuhamed9@gmail.com';
const ADMIN_PASS = '123456';
const COUNTRY = '966';

export const options = {
    stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 15 },
        { duration: '30s', target: 0 },
    ],
};

export function handleSummary(data) { return { "report.html": htmlReport(data) }; }

export default function () {
    const randomSuffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const providerPhone = `900${randomSuffix}`;
    const providerPayload = { phone: providerPhone, countryCode: COUNTRY, typeUser: 'company' };

    let res = http.post(`${BASE_URL}/auth/send-otp`, JSON.stringify(providerPayload), { headers: { 'Content-Type': 'application/json' } });
    res = http.post(`${BASE_URL}/auth/verify-code`, JSON.stringify({ ...providerPayload, code: OTP_CODE }), { headers: { 'Content-Type': 'application/json' } });
    let providerToken = res.json('data.accessToken') || res.json('data.token');
    let providerId = res.json('data.user.id');
    if (!providerToken) return;

    const providerAuth = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${providerToken}` };

    // Profile update via PATCH with application/json
    const formData = {
        fullName: `Provider ${providerPhone}`,
        email: `provider${providerPhone}@test.com`,
        city: 30,
        bio: 'Load test provider account',
    };
    res = http.patch(`${BASE_URL}/user/salon-profile`, JSON.stringify(formData), { headers: providerAuth });
    check(res, { 'Provider profile updated': (r) => r.status === 200 || r.status === 201 });
    sleep(1);

    // Admin login — field is 'user' not 'email'
    res = http.post(`${BASE_URL}/auth/admin/login`, JSON.stringify({
        user: ADMIN_EMAIL,
        password: ADMIN_PASS
    }), { headers: { 'Content-Type': 'application/json' } });
    let adminToken = res.json('data.accessToken') || res.json('data.token');
    
    if (adminToken && providerId) {
        const adminAuth = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` };
        res = http.patch(`${BASE_URL}/web/admin/users/verification/${providerId}/status`, JSON.stringify({ status: 'approved', isActive: true }), { headers: adminAuth });
        check(res, { 'Admin approved provider': (r) => r.status === 200 || r.status === 201 });
    }
}
