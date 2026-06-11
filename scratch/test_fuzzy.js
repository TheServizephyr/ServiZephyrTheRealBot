// Mock Firestore and check if the searchDishes service does fuzzy search correctly
const { searchDishes } = require('../src/services/public/foodSearch.service.js');

// Mock Firestore object with a mock collectionGroup and collection methods
const mockFirestore = {
    collection: (colName) => ({
        get: async () => {
            // Mock businesses map
            const mockData = [
                { id: 'patel-ki-hatti', data: () => ({ name: 'Patel ki Hatti', isPublished: true, isClaimed: true, phone: '9100000000', coordinates: { lat: 28.5386, lng: 77.3647 } }) }
            ];
            return {
                forEach: (cb) => mockData.forEach(cb)
            };
        }
    }),
    collectionGroup: (colName) => ({
        get: async () => {
            const mockData = [
                {
                    id: 'paneer-momos',
                    ref: { parent: { parent: { id: 'patel-ki-hatti' } } },
                    data: () => ({ name: 'Paneer Kurkure Momos', price: 126, isAvailable: true, isVeg: true, description: 'Super crispy momos filled with paneer.' })
                }
            ];
            return {
                forEach: (cb) => mockData.forEach(cb)
            };
        }
    })
};

async function test() {
    try {
        console.log('Testing exact match: "paneer"');
        const res1 = await searchDishes(mockFirestore, { query: 'paneer', lat: 28.5386, lng: 77.3647 });
        console.log('Results 1:', res1.results.map(r => r.dish.name));

        console.log('\nTesting spelling mistake 1: "panir"');
        const res2 = await searchDishes(mockFirestore, { query: 'panir', lat: 28.5386, lng: 77.3647 });
        console.log('Results 2:', res2.results.map(r => r.dish.name));

        console.log('\nTesting spelling mistake 2: "panner"');
        const res3 = await searchDishes(mockFirestore, { query: 'panner', lat: 28.5386, lng: 77.3647 });
        console.log('Results 3:', res3.results.map(r => r.dish.name));

        console.log('\nTesting spelling mistake with multiple words: "panir momos"');
        const res4 = await searchDishes(mockFirestore, { query: 'panir momos', lat: 28.5386, lng: 77.3647 });
        console.log('Results 4:', res4.results.map(r => r.dish.name));

        console.log('\nTesting spelling mistake that should NOT match: "panur"');
        const res5 = await searchDishes(mockFirestore, { query: 'panur', lat: 28.5386, lng: 77.3647 });
        console.log('Results 5:', res5.results.map(r => r.dish.name));
    } catch (err) {
        console.error(err);
    }
}

test();
