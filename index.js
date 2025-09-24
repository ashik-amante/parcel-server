// server.js
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pdx5h.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        await client.connect();

        const parcelCollection = client.db('parcelDB').collection('parcels')

        // pacels api
        app.get('/parcels/:email', async(req,res)=>{
            try{
                const email = req.params.email;
                const query = {created_by : email}
                const result = await parcelCollection.find(query).toArray()
                res.send(result)
            }catch(error){
                console.log('Failed to fetch parcels');
                res.status(500).send({message: 'Failed to fetch parcels'})
            }
        })
        // delete parcels
        app.delete('/parcels/:id', async(req,res)=>{
            try{
                const id = req.params.id
            const query = { _id : new ObjectId(id)}
            const result = await parcelCollection.deleteOne(query)
            res.send(result)
            }catch(error){
                console.log(error);
                res.status(500).send({message: 'Failed to delete parcel'})
            }
        })

        app.post('/parcels', async (req, res) => {
            const parcel = req.body;
            const result = await parcelCollection.insertOne(parcel);
            res.send(result);
        });


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    
    res.send(console.log('Parcel server is running'))
})
app.listen(port, () => {
    console.log(`port is running on ${port}`);
})