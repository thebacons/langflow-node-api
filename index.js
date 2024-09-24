import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('LANGFLOW_API_KEY:', process.env.LANGFLOW_API_KEY); // Debug log

const app = express();
app.use(express.json());

// Middleware to log all incoming requests
app.use((req, res, next) => {
    console.log(`Request URL: ${req.url}`);
    next();
});

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

const langflowApiKey = process.env.LANGFLOW_API_KEY;
if (!langflowApiKey) {
    console.error('Error: The LANGFLOW_API_KEY environment variable is missing or empty.');
    process.exit(1);
}

class LangflowClient {
    constructor(baseURL, apiKey) {
        this.baseURL = baseURL;
        this.apiKey = apiKey;
    }

    async post(endpoint, body, headers = {"Content-Type": "application/json"}) {
        if (this.apiKey) {
            headers["x-api-key"] = this.apiKey;
        }
        const url = `${this.baseURL}${endpoint}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
            }
            return await response.json();
        } catch (error) {
            console.error('Request Error:', error);
            throw error;
        }
    }

    async initiateSession(flowId, inputValue, stream = false, tweaks = {}) {
        const endpoint = `/api/v1/run/${flowId}?stream=${stream}`;
        return this.post(endpoint, { input_value: inputValue, tweaks: tweaks });
    }

    handleStream(streamUrl, onUpdate, onClose, onError) {
        const eventSource = new EventSource(streamUrl);

        eventSource.onmessage = event => {
            const data = JSON.parse(event.data);
            onUpdate(data);
        };

        eventSource.onerror = event => {
            console.error('Stream Error:', event);
            onError(event);
            eventSource.close();
        };

        eventSource.addEventListener("close", () => {
            onClose('Stream closed');
            eventSource.close();
        });

        return eventSource;
    }

    async runFlow(flowIdOrName, inputValue, tweaks, stream = false, onUpdate, onClose, onError) {
        try {
            const initResponse = await this.initiateSession(flowIdOrName, inputValue, stream, tweaks);
            console.log('Init Response:', initResponse);
            if (stream && initResponse && initResponse.outputs && initResponse.outputs[0].outputs[0].artifacts.stream_url) {
                const streamUrl = initResponse.outputs[0].outputs[0].artifacts.stream_url;
                console.log(`Streaming from: ${streamUrl}`);
                this.handleStream(streamUrl, onUpdate, onClose, onError);
            }
            return initResponse;
        } catch (error) {
            console.error('Error running flow:', error);
            onError('Error initiating session');
        }
    }
}

//const langflowClient = new LangflowClient('https://odin-langflow-u23171.vm.elestio.app', langflowApiKey);
const langflowClient = new LangflowClient('https://langflow-1-u23171.vm.elestio.app', langflowApiKey);
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/run-flow', async (req, res) => {
    const { flowIdOrName, inputValue, tweaks, stream } = req.body;
    try {
        const response = await langflowClient.runFlow(
            flowIdOrName,
            inputValue,
            tweaks,
            stream,
            (data) => console.log("Received:", data.chunk), // onUpdate
            (message) => console.log("Stream Closed:", message), // onClose
            (error) => console.log("Stream Error:", error) // onError
        );
        if (!stream) {
            const flowOutputs = response.outputs[0];
            const firstComponentOutputs = flowOutputs.outputs[0];
            const output = firstComponentOutputs.outputs.message;

            res.json({ output: output.message.text });
        } else {
            res.json({ message: 'Streaming started' });
        }
    } catch (error) {
        console.error('Error running flow:', error);
        res.status(500).json({ error: `Error running flow: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
