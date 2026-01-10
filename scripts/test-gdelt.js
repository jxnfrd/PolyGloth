// Test with Brazil crypto news in Portuguese
const searchTerm = encodeURIComponent('Brazil crypto');
const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${searchTerm}&mode=artlist&format=json&sourcelang=pt`;

fetch(url)
    .then(res => res.json())
    .then(data => console.log(`Found ${data.articles?.length || 0} Portuguese articles`))
    .catch(err => console.error(err));
