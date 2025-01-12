import { REPLY_PROMPT } from '../prompts/replyPrompt.js';

let queue = [];
let isProcessing = false;

const MAX_CONCURRENT_REQUESTS = 10;
const MAX_QUEUE_SIZE = 50;
const MAX_TWEET_LENGTH = 1000;

async function downloadAndAnalyzeImage(imageUrl, apiKey) {
  try {
    console.log('🖼️ Downloading image:', imageUrl);
    
    // Download image
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Convert to base64
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

    console.log('📸 Analyzing downloaded image');
    
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe what's in this image briefly, focusing on the main elements. Be direct and factual."
              },
              {
                type: "image_url",
                image_url: {
                  url: base64
                }
              }
            ]
          }
        ],
        max_tokens: 100,
        temperature: 0.7
      })
    });

    if (!completion.ok) {
      const error = await completion.json();
      console.error('❌ Image analysis error:', error);
      return null;
    }

    const data = await completion.json();
    const analysis = data.choices[0]?.message?.content?.trim() || null;
    console.log('✅ Image analysis complete:', analysis);
    return analysis;
  } catch (error) {
    console.error('❌ Image analysis error:', error);
    return null;
  }
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  
  isProcessing = true;
  const { resolve, reject, tweet, images, imageAnalysis } = queue.shift();
  
  try {
    const { apiKey } = await chrome.storage.local.get(['apiKey']);
    if (!apiKey) {
      throw new Error('OpenAI API key not found. Please set it in the extension settings.');
    }

    let imageContext = '';
    if (imageAnalysis) {
      // Use cached analysis
      console.log('📝 Using cached image analysis');
      imageContext = imageAnalysis;
    } else if (images && images.length > 0) {
      // Perform new analysis
      console.log(`🖼️ Processing tweet with ${images.length} image(s)`);
      const analysis = await downloadAndAnalyzeImage(images[0], apiKey);
      if (analysis) {
        imageContext = analysis;
      }
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
          { role: "user", content: REPLY_PROMPT.generateUserPrompt(tweet || '', imageContext) }
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

    resolve({ 
      reply,
      imageAnalysis: imageContext // Return the analysis for caching
    });
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
  // Allow empty text if there are images
  if (!tweetData.text && (!tweetData.images || tweetData.images.length === 0)) {
    throw new Error('Tweet must contain either text or images');
  }

  if (tweetData.text && tweetData.text.length > MAX_TWEET_LENGTH) {
    throw new Error(`Tweet text must not exceed ${MAX_TWEET_LENGTH} characters`);
  }

  if (queue.length >= MAX_QUEUE_SIZE) {
    throw new Error('Server is too busy. Please try again later.');
  }

  console.log('📝 Processing tweet:', {
    hasText: !!tweetData.text,
    textLength: tweetData.text?.length || 0,
    imageCount: tweetData.images?.length || 0,
    hasImageAnalysis: !!tweetData.imageAnalysis
  });

  return new Promise((resolve, reject) => {
    queue.push({ 
      resolve, 
      reject, 
      tweet: tweetData.text,
      images: tweetData.images,
      imageAnalysis: tweetData.imageAnalysis
    });
    processQueue();
  });
} 