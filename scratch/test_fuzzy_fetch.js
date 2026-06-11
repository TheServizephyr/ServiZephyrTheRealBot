async function test() {
    try {
        const query1 = 'panir';
        console.log(`Fetching results for: "${query1}"`);
        const res1 = await fetch(`http://localhost:3000/api/public/food-search?q=${query1}`);
        const data1 = await res1.json();
        console.log('Results (panir):', data1.results.map(r => r.dish?.name || r.restaurant.name));

        const query2 = 'panner';
        console.log(`\nFetching results for: "${query2}"`);
        const res2 = await fetch(`http://localhost:3000/api/public/food-search?q=${query2}`);
        const data2 = await res2.json();
        console.log('Results (panner):', data2.results.map(r => r.dish?.name || r.restaurant.name));

        const query3 = 'biryany';
        console.log(`\nFetching results for: "${query3}"`);
        const res3 = await fetch(`http://localhost:3000/api/public/food-search?q=${query3}`);
        const data3 = await res3.json();
        console.log('Results (biryany):', data3.results.map(r => r.dish?.name || r.restaurant.name));
    } catch (err) {
        console.error(err);
    }
}

test();
