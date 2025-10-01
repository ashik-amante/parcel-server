// server.js
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken')
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());



const serviceAccount = require("./firebse-admin-key.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


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
        const paymentCollection = client.db('parcelDB').collection('payments')
        const usersCollection = client.db('parcelDB').collection('users')
        const riderCollection = client.db('parcelDB').collection('riders')

        // middle wire custom
        const verifyToken = async (req, res, next) => {
            const authHeader = req.headers['authorization'];
            if (!authHeader) {
                return res.status(401).send({ message: "Unauthorized" });
            }

            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: "Unauthorized" });
            }

            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            } catch (error) {
                return res.status(403).send({ message: "Forbidden access" });
            }
        };


        app.post('/users', async (req, res) => {
            const user = req.body
            const isExist = await usersCollection.findOne({ email: user.email })

            if (isExist) {
                return res.status(200).send({ message: 'users already exist' })
            }

            const result = await usersCollection.insertOne(user)
            res.send(result)
        })

        // pacels api
        app.get('/parcels/:email', verifyToken, async (req, res) => {
            try {
                const email = req.params.email;
                const query = { created_by: email }
                const result = await parcelCollection.find(query).toArray()
                res.send(result)
            } catch (error) {
                console.log('Failed to fetch parcels');
                res.status(500).send({ message: 'Failed to fetch parcels' })
            }
        })
        // parcel detail by id 
        app.get('/parcels/payment/:id', async (req, res) => {
            const id = req.params.id
            const result = await parcelCollection.findOne({ _id: new ObjectId(id) })
            res.send(result)
        })
        // delete parcels
        app.delete('/parcels/:id', verifyToken, async (req, res) => {
            try {
                const id = req.params.id
                const query = { _id: new ObjectId(id) }
                const result = await parcelCollection.deleteOne(query)
                res.send(result)
            } catch (error) {
                console.log(error);
                res.status(500).send({ message: 'Failed to delete parcel' })
            }
        })

        app.post('/parcels', async (req, res) => {
            const parcel = req.body;
            const result = await parcelCollection.insertOne(parcel);
            res.send(result);
        });
        // payment intent 
        app.post('/create-payment-intent', async (req, res) => {
            try {
                const { amount } = req.body
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: 'usd',
                    payment_method_types: ['card'],
                })
                res.send({ clientSecret: paymentIntent.client_secret })
            } catch (err) {
                res.status(500).send({ error: error.message })
            }
        })
        // payments
        app.post('/payments', async (req, res) => {
            const payment = req.body;
            // update parcel documnet
            await parcelCollection.updateOne({ _id: new ObjectId(payment.parcelId) }, {
                $set: { payment_status: 'paid' }
            })
            // save data to payment 
            const result = await paymentCollection.insertOne(payment)
            res.send(result)
        })
        // payment hidtory
        app.get('/payments/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            console.log('decoded', req.decoded);
            if (req.decoded.email !== email) {
                return res.status(403).send({ message: "forbidden access" })
            }
            console.log(email);
            const result = await paymentCollection
                .find({ email: email })
                .sort({ paidAt: -1 })
                .toArray()
            res.send(result)
        })

        // rider api
        app.post('/riders', async(req,res)=>{
            const riderData = req.body
            const result = await riderCollection.insertOne(riderData)
            res.send(result)
        })
        // pending riders
        app.get('/riders/pending', async(req,res)=>{
            const pendingRiders = await riderCollection.find({status : "pending"}).toArray()
            res.send(pendingRiders)
        })
        app.get('/riders/approved', async(req,res)=>{
            const pendingRiders = await riderCollection.find({status : "approved"}).toArray()
            res.send(pendingRiders)
        })
        // approce reject
        app.patch('/riders/:id', async(req,res)=>{
            const id = req.params.id
            const {status} = req.body
            console.log(status, 'in patch');
            const query = {_id : new ObjectId(id)}
            const updatedDoc = {
                $set: {
                    status
                }
            }
            const result = await riderCollection.updateOne(query,updatedDoc)
            res.send(result)
        })


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