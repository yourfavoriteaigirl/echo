class PromptBuilder {
  constructor() {
    this.messageStructure = null;
    this.imageAnalysis = null;
    this.personality = null;
  }

  async initialize() {
    try {
      const structureResponse = await fetch(chrome.runtime.getURL('config/prompts/message_structure.json'));
      this.messageStructure = await structureResponse.json();

      const imageAnalysisResponse = await fetch(chrome.runtime.getURL('config/prompts/image_analysis.json'));
      this.imageAnalysis = await imageAnalysisResponse.json();
    } catch (error) {
      console.error('Error initializing PromptBuilder:', error);
      throw error;
    }
  }

  async loadPersonality(personalityId) {
    try {
      const indexResponse = await fetch(chrome.runtime.getURL('config/personality_index.json'));
      const { personalities } = await indexResponse.json();
      
      const personalityConfig = personalities.find(p => p.id === personalityId);
      if (!personalityConfig) {
        throw new Error(`Personality ${personalityId} not found`);
      }

      const detailsResponse = await fetch(chrome.runtime.getURL(`config/${personalityConfig.file}`));
      this.personality = await detailsResponse.json();
    } catch (error) {
      console.error('Error loading personality:', error);
      throw error;
    }
  }

  buildImageAnalysisPrompt(images) {
    if (!images || images.length === 0) return null;

    return {
      role: 'system',
      content: "You're a CT degen. Look at these images. What's the first thing that makes you want to reply? Don't analyze, just react."
    };
  }

  buildTweetAnalysisPrompt(tweetData) {
    const { text, threadContext, quoteText, originalTweet } = tweetData;
    
    return {
      role: 'system',
      content: `Analyze this CT content for the perfect reply trigger:

Tweet: ${text}
${threadContext ? `Thread Context: ${threadContext}\n` : ''}
${quoteText ? `Quote Tweet: ${originalTweet} -> ${quoteText}\n` : ''}

IDENTIFY THESE TRIGGERS:
1. Market Talk:
   - Price action/charts -> be sarcastic about gains/losses
   - Project launches -> comment on timing/entry
   - Trading -> self-deprecate about missed opportunities

2. Drama/Controversy:
   - Scams/rugs -> mock the situation
   - Project drama -> pick sides chaotically
   - Community beef -> amplify the chaos

3. Tech/Projects:
   - New features -> question necessity
   - Tokenomics -> comment on bags
   - Airdrops -> discuss claims/missed opportunities

4. Social Dynamics:
   - Flexing -> either support or mock
   - Community events -> comment on vibes
   - Personal updates -> relate chaotically

5. Memes/Culture:
   - CT in-jokes -> reference shared history
   - Platform drama -> take controversial stance
   - Gaming/NFTs -> discuss personal experience

Extract ONLY the key elements that would trigger DeeZe's authentic response style.`
    };
  }

  buildPersonalityPrompt() {
    return {
      role: 'system',
      content: `You are DeeZe, the chaotic voice of CT. Your replies are highly contextual:

RESPONSE PATTERNS (with real examples):

1. PRICE TARGETS/PREDICTIONS:
- Meme numbers: "between here and $22 is obvious buying spot, if $22 breaks down, $18~"
- Hopium posts: "we are SO early"
- Engagement farming: "yeah im not worried explaining shit to people who are buying $20 worth of something"

2. MARKET SENTIMENT:
- Bull market: "send it"
- Bear market: "ngmi"

3. DRAMA/CONTROVERSY:
- Project drama: "half these devs value their reputation like stale bread"
- Community beef: "you little incel fuck"
- Scams: "Same they stealth added that shit"

4. QUICK REACTIONS:
- Based takes: "real"
- Bad takes: "ngmi"
- Agreement: "so true"

KEY RULES:
1. Keep it raw and authentic
2. Use CT slang naturally
3. Match the tweet's energy
4. No explanations or apologies
5. Use 'lmao' only when genuinely funny
6. Keep it short and impactful

Now channel DeeZe's energy and craft a contextually appropriate reply.`
    };
  }

  async buildPromptChain(tweetData) {
    if (!this.messageStructure || !this.personality) {
      throw new Error('Prompt builder not properly initialized');
    }

    const chain = [];
    const { images } = tweetData;
    let analysisContext = {
      imageAnalysis: null,
      tweetAnalysis: null,
      personalityContext: null
    };

    // Add image analysis if images present
    if (images && images.length > 0) {
      const imageStep = this.messageStructure.chain.find(step => step.id === 'image_analysis');
      chain.push({
        messages: [
          this.buildImageAnalysisPrompt(images),
          {
            role: 'user',
            content: images.map(url => `<image>${url}</image>`).join('\n')
          }
        ],
        ...imageStep,
        max_tokens: 200
      });
    }

    // Add tweet analysis
    const tweetStep = this.messageStructure.chain.find(step => step.id === 'tweet_analysis');
    chain.push({
      messages: [
        this.buildTweetAnalysisPrompt(tweetData),
        {
          role: 'user',
          content: `ANALYZE THIS TWEET:\n${tweetData.text}\n\nCONTEXT:\n${images ? `- Contains ${images.length} image(s)\n` : ''}${tweetData.quoteText ? `- Quote Tweet: ${tweetData.quoteText}\n` : ''}\n\nProvide a detailed analysis following the format above.`
        }
      ],
      ...tweetStep,
      max_tokens: 500
    });

    // Add personality injection with analysis context
    const personalityStep = this.messageStructure.chain.find(step => step.id === 'personality_injection');
    chain.push({
      messages: [
        this.buildPersonalityPrompt(),
        {
          role: 'user',
          content: `TWEET: ${tweetData.text}\n\nUse the analysis to craft a DeeZe-style response.`
        }
      ],
      ...personalityStep,
      max_tokens: 200
    });

    // Add final reply with full context
    const finalStep = this.messageStructure.chain.find(step => step.id === 'final_reply');
    chain.push({
      messages: [
        {
          role: 'system',
          content: finalStep.system_prompt
        },
        {
          role: 'user',
          content: `TWEET: ${tweetData.text}\n\nGenerate a natural CT response that captures DeeZe's voice and incorporates the analysis.`
        }
      ],
      ...finalStep
    });

    // Add formatting step
    const formatStep = this.messageStructure.chain.find(step => step.id === 'format_reply');
    if (formatStep) {
      chain.push({
        messages: [
          {
            role: 'system',
            content: formatStep.system_prompt
          },
          {
            role: 'user',
            content: 'Format the previous response into a short, punchy DeeZe-style reply.'
          }
        ],
        ...formatStep
      });
    }

    return chain;
  }

  getFinalPromptParameters() {
    const finalStep = this.messageStructure.chain.find(step => step.id === 'final_reply');
    const formatStep = this.messageStructure.chain.find(step => step.id === 'format_reply');
    return {
      ...this.messageStructure.defaults,
      ...(formatStep?.parameters || finalStep?.parameters),
      temperature: 0.9,
      presence_penalty: 0.7,
      frequency_penalty: 0.7,
      max_tokens: 250  // Allow longer responses when needed
    };
  }

  async buildRegenerationChain(tweetData, analysisContext) {
    if (!this.messageStructure || !this.personality) {
      throw new Error('Prompt builder not properly initialized');
    }

    const chain = [];

    // Add final reply with cached analysis
    const finalStep = this.messageStructure.chain.find(step => step.id === 'final_reply');
    chain.push({
      messages: [
        {
          role: 'system',
          content: finalStep.system_prompt
        },
        {
          role: 'user',
          content: `TWEET: ${tweetData.text}

ANALYSIS CONTEXT:
${analysisContext.imageAnalysis ? `Image Analysis: ${analysisContext.imageAnalysis}\n` : ''}
Tweet Analysis: ${analysisContext.tweetAnalysis}
Personality Context: ${analysisContext.personalityContext}

Generate a new natural CT response that captures DeeZe's voice.`
        }
      ],
      ...finalStep
    });

    // Add formatting step
    const formatStep = this.messageStructure.chain.find(step => step.id === 'format_reply');
    if (formatStep) {
      chain.push({
        messages: [
          {
            role: 'system',
            content: formatStep.system_prompt
          },
          {
            role: 'user',
            content: 'Format the previous response into a short, punchy DeeZe-style reply.'
          }
        ],
        ...formatStep
      });
    }

    return chain;
  }
}

export default PromptBuilder; 