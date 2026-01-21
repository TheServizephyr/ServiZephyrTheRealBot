const RESTAURANT_ID = "ashwani's-restaurant";
const TABLE_ID = "T10";
const CAPACITY = 4;
const BASE_URL = "https://www.servizephyr.com";

async function createTab(i) {
    try {
        const res = await fetch(`${BASE_URL}/api/dine-in/create-tab`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                restaurantId: RESTAURANT_ID,
                tableId: TABLE_ID,
                capacity: CAPACITY,
                groupSize: 1,
                customerName: `TestGuest_${i}`
            })
        });

        const data = await res.json();
        console.log(`Attempt ${i}: Status ${res.status}`, data.error ? `Error: ${data.error}` : `Success: ${data.tabId}`);
        return res.status;
    } catch (e) {
        console.log(`Attempt ${i}: Failed`, e.message);
        return 0;
    }
}

async function runTest() {
    console.log(`--- STARTING CAPACITY TEST (Cap: ${CAPACITY}) ---`);

    // Create 4 tabs (should succeed)
    for (let i = 1; i <= 4; i++) {
        await createTab(i);
    }

    // Create 5th tab (SHOULD FAIL)
    console.log("--- ATTEMPTING OVERFLOW (5th Guest) ---");
    const status = await createTab(5);

    if (status === 500 || status === 400) {
        console.log("✅ TEST PASSED: Overflow rejected!");
    } else {
        console.log("❌ TEST FAILED: Overflow allowed!");
    }
}

runTest();
