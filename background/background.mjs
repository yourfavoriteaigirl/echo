import { REPLY_PROMPT } from '../prompts/replyPrompt.js';

let queue = [];
let isProcessing = false;

const MAX_CONCURRENT_REQUESTS = 10;
const MAX_QUEUE_SIZE = 50;
const MAX_TWEET_LENGTH = 1000;

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  
  isProcessing = true;
  const { resolve, reject, tweet } = queue.shift();
  
  try {
    const { apiKey } = await chrome.storage.local.get(['apiKey']);
    if (!apiKey) {
      throw new Error('OpenAI API key not found. Please set it in the extension settings.');
    }

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: REPLY_PROMPT.system },
          { role: "user", content: REPLY_PROMPT.generateUserPrompt(tweet) }
        ],
        temperature: 0.9,
        max_tokens: 150,
        presence_penalty: 0.6,
        frequency_penalty: 0.5
      })
    });

    if (!completion.ok) {
      const error = await completion.json();
      throw new Error(error.error?.message || 'Failed to generate reply');
    }

    const data = await completion.json();
    const reply = data.choices[0]?.message?.content?.trim();
    if (!reply) {
      throw new Error('No reply generated');
    }

    resolve({ reply });
  } catch (error) {
    console.error('Processing error:', error);
    reject(error);
  } finally {
    isProcessing = false;
    setTimeout(processQueue, 0);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GENERATE_REPLY') {
    handleGenerateReply(request.data)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

async function handleGenerateReply(tweetData) {
  if (!tweetData.text || tweetData.text.length > MAX_TWEET_LENGTH) {
    throw new Error(`Tweet must be between 1 and ${MAX_TWEET_LENGTH} characters`);
  }

  if (queue.length >= MAX_QUEUE_SIZE) {
    throw new Error('Server is too busy. Please try again later.');
  }

  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject, tweet: tweetData.text });
    processQueue();
  });
} 