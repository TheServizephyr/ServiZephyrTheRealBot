const fs = require('fs');

async function check() {
    try {
        const res = await fetch('http://localhost:3000/search?q=momos');
        const html = await res.text();
        // find Patel ki Hatti and print the surrounding 500 chars
        const idx = html.indexOf('Patel ki Hatti');
        if (idx !== -1) {
            console.log('FOUND Patel ki Hatti:');
            console.log(html.substring(idx - 300, idx + 300));
        } else {
            console.log('NOT FOUND Patel ki Hatti. HTML length:', html.length);
            // Print some HTML to see what's going on
            console.log(html.substring(0, 1000));
        }
    } catch (err) {
        console.error(err);
    }
}

check();
