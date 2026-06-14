import http from 'k6/http';
import { check, sleep } from 'k6';
import { vu } from 'k6/execution';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

const BASE_URL = 'https://lambda-dev.mycoifeur.com.sa/api/v1';
const OTP_CODE = '1234';
const COUNTRY = '966';

export const options = {
    stages: [
        { duration: '30s', target: 5 },
        { duration: '1m', target: 20 },
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
    
    let userToken = res.json('data.accessToken') || res.json('data.token');
    if (!userToken) return;
    const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` };

    // Fetch dynamic service ID — loop through providers to find one with services
    let serviceId = null;
    let salonsRes = http.get(`${BASE_URL}/salons/search`, { headers: authHeaders });
    let providersList = salonsRes.json('data.data') || [];

    for (let i = 0; i < providersList.length; i++) {
        let pid = providersList[i].id;
        let svcRes = http.get(`${BASE_URL}/services?salonId=${pid}`, { headers: authHeaders });
        let svcList = svcRes.json('data.data') || [];
        if (svcList.length > 0) {
            serviceId = svcList[0].id;
            break;
        }
    }

    if (!serviceId) return; // no provider has services, skip iteration

    res = http.post(`${BASE_URL}/cart/add`, JSON.stringify({ serviceId }), { headers: authHeaders });
    check(res, { 'Service added to cart': (r) => r.status === 200 || r.status === 201 });
    sleep(1);

    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const bookDateStr = tomorrow.toISOString().split('T')[0];

    // Fetch REAL available time slots from the API
    let timesRes = http.get(
        `${BASE_URL}/cart/available_times?date=${bookDateStr}&serviceId=${serviceId}`,
        { headers: authHeaders }
    );
    let allSlots = timesRes.json('data') || [];
    let availableSlots = allSlots.filter(s => s.available === true);

    if (availableSlots.length === 0) return; // no slots available, skip

    // Each VU picks a different available slot
    const vuId = vu.idInTest || 1;
    const iterNum = vu.iterationInInstance || 0;
    const slot = availableSlots[(vuId + iterNum) % availableSlots.length];
    const startTime = slot.time.replace(' am', '').replace(' pm', ''); // e.g. "06:30"
    // Convert 12h to 24h
    const isPm = slot.time.includes('pm');
    const parts = startTime.split(':');
    let h24 = parseInt(parts[0]);
    if (isPm && h24 !== 12) h24 += 12;
    if (!isPm && h24 === 12) h24 = 0;
    const startTime24 = `${String(h24).padStart(2, '0')}:${parts[1]}:00`;

    res = http.post(`${BASE_URL}/cart/i/complet`, JSON.stringify({
        startTime: startTime24, bookDate: bookDateStr, placeOfService: "salon", addressId: 1, note: "Test booking note"
    }), { headers: authHeaders });
    check(res, { 'Booking details added': (r) => r.status === 200 || r.status === 201 });
    sleep(1);

    // Randomly choose between Wallet and Card for payment
    const isWallet = Math.random() > 0.5;
    const paymentPayload = {
        startTime: startTime24, bookDate: bookDateStr, useWallet: isWallet
    };
    if (isWallet) {
        paymentPayload.paymentMethod = "wallet";
    } else {
        paymentPayload.paymentMethod = "card";
        paymentPayload.card = { number: '5123450000000005', expiry: '01/39', cvv: '100' };
    }

    res = http.post(`${BASE_URL}/cart/i/choose/payment`, JSON.stringify(paymentPayload), { headers: authHeaders });
    check(res, { 'Payment completed': (r) => r.status === 200 || r.status === 201 });

    res = http.get(`${BASE_URL}/orders/i`, { headers: authHeaders });
    check(res, { 'Track orders': (r) => r.status === 200 });
}
