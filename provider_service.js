import http from 'k6/http';
import { check, sleep } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

const BASE_URL = 'https://lambda-dev.mycoifeur.com.sa/api/v1';
const OTP_CODE = '1234';
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

    // 1. Create Profile
    const formData = {
        fullName: `Provider ${providerPhone}`, email: `provider${providerPhone}@test.com`,
        city: 30, bio: 'Service test provider',
    };
    http.patch(`${BASE_URL}/user/salon-profile`, JSON.stringify(formData), { headers: providerAuth });

    // Admin approval no longer required for typeUser: company

    // 3. Service Create via JSON
    const providerAuthJson = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${providerToken}` };
    res = http.post(`${BASE_URL}/salon/services/create`, JSON.stringify({
        title_en: 'Premium Haircut', title_ar: 'قصة شعر مميزة', 
        content_en: 'Premium haircut service', content_ar: 'خدمة قص الشعر',
        price_first: '150', category_id: '1', time: '00:30:00', status: 'show'
    }), { headers: providerAuthJson });
    check(res, { 'Service created': (r) => r.status === 200 || r.status === 201 });

    // Working days is PUT and uses different schema
    res = http.put(`${BASE_URL}/salon/profile/working-days`, JSON.stringify({
        working_days: [
            { day: 'monday', from: '09:00', to: '18:00' },
            { day: 'tuesday', from: '09:00', to: '18:00' }
        ]
    }), { headers: providerAuthJson });
    check(res, { 'Schedule added': (r) => r.status === 200 || r.status === 201 });
}
