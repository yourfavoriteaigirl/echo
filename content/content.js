const BUTTON_CLASS = 'echo-reply-button';
const MODAL_CLASS = 'echo-reply-modal';

function createReplyButton() {
  const button = document.createElement('button');
  button.className = BUTTON_CLASS;
  button.innerHTML = `<img src="${chrome.runtime.getURL('logo.png')}" alt="ECHO">`;
  return button;
}

function createModal() {
  const modal = document.createElement('div');
  modal.className = 'echo-reply-popup';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="popup-header">
      <h3>ECHO Reply</h3>
      <button class="close-button" aria-label="Close">×</button>
    </div>
    <div class="popup-body">
      <div class="loading-spinner"></div>
      <div class="generated-reply" style="display: none;">
        <textarea readonly></textarea>
        <div class="action-buttons">
          <button class="copy-button">Copy</button>
          <button class="regenerate-button">Regenerate</button>
        </div>
      </div>
    </div>
  `;

  const header = modal.querySelector('.popup-header');
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  const dragStart = (e) => {
    if (e.target.closest('.close-button')) return;
    
    if (e.type === "touchstart") {
      initialX = e.touches[0].clientX - xOffset;
      initialY = e.touches[0].clientY - yOffset;
    } else {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
    }
    
    if (e.target === header || e.target.closest('.popup-header')) {
      isDragging = true;
      modal.style.transition = 'none';
    }
  };

  const dragEnd = () => {
    if (!isDragging) return;
    
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
    modal.style.transition = 'all 0.2s ease-out';
  };

  const drag = (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    
    if (e.type === "touchmove") {
      currentX = e.touches[0].clientX - initialX;
      currentY = e.touches[0].clientY - initialY;
    } else {
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
    }

    xOffset = currentX;
    yOffset = currentY;
    
    modal.style.transform = `translate(calc(-50% + ${currentX}px), calc(-50% + ${currentY}px)) scale(1)`;
  };

  header.addEventListener('mousedown', dragStart);
  header.addEventListener('touchstart', dragStart, { passive: true });
  document.addEventListener('mousemove', drag);
  document.addEventListener('touchmove', drag, { passive: false });
  document.addEventListener('mouseup', dragEnd);
  document.addEventListener('touchend', dragEnd);

  const closeButton = modal.querySelector('.close-button');
  closeButton.addEventListener('click', () => {
    modal.classList.remove('visible');
    setTimeout(() => {
      modal.remove();
      document.removeEventListener('mousemove', drag);
      document.removeEventListener('touchmove', drag);
      document.removeEventListener('mouseup', dragEnd);
      document.removeEventListener('touchend', dragEnd);
    }, 200);
  });

  return modal;
}

function processTweet(tweetElement) {
  const tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
  const mainText = tweetTextElement ? tweetTextElement.textContent : '';

  const threadElements = tweetElement.querySelectorAll('[data-testid="tweetText"]');
  let fullText = mainText;

  if (threadElements.length > 1) {
    fullText = Array.from(threadElements)
      .map(el => el.textContent)
      .join('\n\n');
  }

  return {
    text: fullText
  };
}

function injectButtonIntoTweet(tweetElement) {
  if (tweetElement.querySelector(`.${BUTTON_CLASS}`)) return;

  const actionsBar = tweetElement.querySelector('[role="group"]');
  if (!actionsBar) return;

  const button = createReplyButton();
  actionsBar.appendChild(button);

  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    let modal = document.querySelector('.echo-reply-popup');
    const isRefresh = !!modal;
    
    if (!modal) {
      modal = createModal();
      modal.style.display = 'none';
      document.body.appendChild(modal);
      modal.offsetHeight;
      modal.style.display = 'flex';
      modal.classList.add('visible');
    }

    const replyArea = modal.querySelector('.generated-reply');
    const loadingSpinner = modal.querySelector('.loading-spinner');
    replyArea.style.display = 'none';
    loadingSpinner.style.display = 'flex';

    try {
      const tweetData = processTweet(tweetElement);
      
      chrome.runtime.sendMessage({
        type: 'GENERATE_REPLY',
        data: tweetData
      }, response => {
        const replyArea = modal.querySelector('.generated-reply');
        const loadingSpinner = modal.querySelector('.loading-spinner');
        const textarea = replyArea.querySelector('textarea');
        
        if (response.error) {
          loadingSpinner.style.display = 'none';
          replyArea.style.display = 'block';
          textarea.value = `Error: ${response.error}`;
          return;
        }

        loadingSpinner.style.display = 'none';
        replyArea.style.display = 'block';
        textarea.value = response.reply;

        if (!isRefresh) {
          const copyButton = replyArea.querySelector('.copy-button');
          copyButton.addEventListener('click', () => {
            textarea.select();
            document.execCommand('copy');
            copyButton.textContent = 'Copied!';
            setTimeout(() => {
              copyButton.textContent = 'Copy';
            }, 2000);
          });

          const regenerateButton = replyArea.querySelector('.regenerate-button');
          regenerateButton.addEventListener('click', () => {
            loadingSpinner.style.display = 'flex';
            replyArea.style.display = 'none';
            
            chrome.runtime.sendMessage({
              type: 'GENERATE_REPLY',
              data: tweetData
            }, newResponse => {
              loadingSpinner.style.display = 'none';
              replyArea.style.display = 'block';
              if (newResponse.error) {
                textarea.value = `Error: ${newResponse.error}`;
              } else {
                textarea.value = newResponse.reply;
              }
            });
          });
        }
      });
    } catch (error) {
      const replyArea = modal.querySelector('.generated-reply');
      const loadingSpinner = modal.querySelector('.loading-spinner');
      const textarea = replyArea.querySelector('textarea');
      
      loadingSpinner.style.display = 'none';
      replyArea.style.display = 'block';
      textarea.value = `Error: ${error.message}`;
    }
  });
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tweets = node.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach(injectButtonIntoTweet);
      }
    }
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
}); 