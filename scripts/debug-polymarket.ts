import axios from 'axios';

async function main() {
    try {
        const response = await axios.get('https://gamma-api.polymarket.com/markets', {
            params: { limit: 1, active: true, volume_min: 50000 }
        });
        console.log("MARKET DATA Keys:", Object.keys(response.data[0]));
        console.log("MARKET DATA Sample:", {
            id: response.data[0].id,
            slug: response.data[0].slug,
            market_slug: response.data[0].market_slug,
            event_slug: response.data[0].event_slug,
            group_slug: response.data[0].group_slug,
            question: response.data[0].question
        });
    } catch (e) {
        console.error(e);
    }
}

main();
