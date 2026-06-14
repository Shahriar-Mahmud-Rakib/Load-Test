import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

const errorRate = new Rate('errors');
const BASE_URL = 'https://lambda-dev.mycoifeur.com.sa/api/v1';
const OTP_CODE = '1234';
const COUNTRY = '966';

export const options = {
    stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
    ],
};

export function handleSummary(data) { return { "report.html": htmlReport(data) }; }

export default function () {
    const randomSuffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const userPhone = `800${randomSuffix}`;
    const userPayload = { phone: userPhone, countryCode: COUNTRY, typeUser: 'user' };

    let res = http.post(`${BASE_URL}/auth/send-otp`, JSON.stringify(userPayload), { headers: { 'Content-Type': 'application/json' } });
    
    res = http.post(`${BASE_URL}/auth/verify-code`, JSON.stringify({ ...userPayload, code: OTP_CODE }), { headers: { 'Content-Type': 'application/json' } });
    check(res, { 'User logged in': (r) => r.status === 200 || r.status === 201 }) || errorRate.add(1);
    
    sleep(1);
}
