// Gamma REST API (since GraphQL endpoint is 404)
const url = 'https://gamma-api.polymarket.com/markets?limit=5&active=true&closed=false';

fetch(url)
    .then(res => res.json())
    .then(data => {
        // Gamma returns array directly or inside data? usually array or paginated.
        const markets = Array.isArray(data) ? data : (data.data || []);
        console.log(JSON.stringify(markets.map(m => ({
            id: m.id,
            question: m.question,
            slug: m.slug
        })), null, 2));
    })
    .catch(err => console.error(err));
