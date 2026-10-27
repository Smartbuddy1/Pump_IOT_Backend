async function testApi() {
    try {
        console.log("Logging in as Super Admin...");
        const loginRes = await fetch('http://localhost:5000/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: '9284188705',
                password: 'admin123'
            })
        });
        const loginData = await loginRes.json();
        console.log(loginData);
        const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6IlN1cGVyIEFkbWluIiwiaWF0IjoxNzkxNDM0Mzc0LCJleHAiOjE3OTE0Mzc5NzR9.98jhKwMR2_2jrUxJYyuhAG1PgYv9beGoCiQXPYJ3kZM';
        if (!token) return;
        console.log("Got token.");
        
        console.log("Creating OMC...");
        const omcRes = await fetch('http://localhost:5000/api/v1/omc', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                name: 'hp3',
                location: 'niphad',
                contact: '8796654568',
                contact_password: '12345'
            })
        });
        const omcData = await omcRes.json();
        console.log("Response Status:", omcRes.status);
        console.log("Response Body:", omcData);
    } catch (e) {
        console.error("Error:", e);
    }
}
testApi();
