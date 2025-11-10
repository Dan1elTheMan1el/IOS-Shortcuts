document.addEventListener('DOMContentLoaded', () => {

async function loadCodenamesWords() {
  const grid = document.getElementById('codenames-grid');
  const player1Label = document.getElementById('player1-label');
  const player2Label = document.getElementById('player2-label');
  const clueForm = document.getElementById('clue-form');
  const clueDisplay = document.getElementById('clue-display');
  const params = new URLSearchParams(window.location.search);
  const gamedata = JSON.parse(decodeURIComponent(params.get('gamedata')));
  player1Label.textContent = `Player 1: ${gamedata.player1 || ''}`;
  player2Label.textContent = `Player 2: ${gamedata.player2 || ''}`;
  const turn = gamedata.turn;
  // Bold current player's name
  player1Label.style.fontWeight = turn % 2 === 1 ? 'bold' : 'normal';
  player2Label.style.fontWeight = turn % 2 === 0 ? 'bold' : 'normal';
  let words = gamedata.data;
  let status1 = gamedata.status1;
  let status2 = gamedata.status2;
  
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  overlay.style.color = 'white';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.fontSize = '24px';
  overlay.style.zIndex = '1000';

  // Check for win/loss in gamedata.state
  if (gamedata.state) {
    let message = '';
    let color = '';
    if (gamedata.state === 'win') {
      message = 'Congratulations, you win!';
      color = 'rgba(0, 76, 0, 0.6)';
    } else if (gamedata.state === 'lose') {
      message = 'Game over, you lose.';
      color = 'rgba(107, 0, 0, 0.6)';
    }
    overlay.textContent = message;
    overlay.style.backgroundColor = color;
    document.body.appendChild(overlay);
  }

  if (gamedata.uuid !== gamedata.uuid1 && gamedata.uuid !== gamedata.uuid2) {
    overlay.textContent = 'The game is full.';
    document.body.appendChild(overlay);
  } else if ((gamedata.uuid === gamedata.uuid1 && turn % 2 === 0) || (gamedata.uuid === gamedata.uuid2 && turn % 2 === 1)) {
    overlay.textContent = "Waiting for partner's turn.";
    document.body.appendChild(overlay);
  }

  // Generate words and status arrays on turn 1
  if (turn === 1 && !words) {
    const response = await fetch('words.txt');
    const text = await response.text();
    let allWords = text.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
    // Shuffle and pick 25
    for (let i = allWords.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allWords[i], allWords[j]] = [allWords[j], allWords[i]];
    }
    words = allWords.slice(0, 25);
  }
  
  if (turn === 1 && (!status1 || !status2)) {
    let indices = Array.from({length: 25}, (_, i) => i);
    // Shuffle indices
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    // 3 overlapping agents, 6 unique each, 3 assassins each
    const overlapAgents = indices.slice(0, 3);
    const p1Agents = overlapAgents.concat(indices.slice(3, 9));
    const p2Agents = overlapAgents.concat(indices.slice(9, 15));
    const p1Assassins = indices.slice(15, 18);
    const p2Assassins = indices.slice(18, 21);
    
    status1 = words.map((word, i) => ({
      word,
      status: p1Agents.includes(i) ? 'agent' : p1Assassins.includes(i) ? 'assassin' : 'bystander'
    }));
    status2 = words.map((word, i) => ({
      word,
      status: p2Agents.includes(i) ? 'agent' : p2Assassins.includes(i) ? 'assassin' : 'bystander'
    }));
  }
  
  // Sync word fields on turn 1 if status arrays exist
  if (turn === 1 && status1 && status2) {
    for (let i = 0; i < 25; i++) {
      status1[i].word = words[i];
      status2[i].word = words[i];
    }
  }
  // Always use the latest status arrays for rendering
  window._codenamesWords = words;
  window._codenamesStatus1 = status1;
  window._codenamesStatus2 = status2;
  
  if (gamedata.clue) {
    clueDisplay.innerHTML = `<b>Clue:</b> <span style="letter-spacing:0.04em;">${gamedata.clue.clue.toUpperCase()}</span> &nbsp; <b>Count:</b> ${gamedata.clue.count}`;
    let guessCount = gamedata.clue.count + 1;
    let counterDiv = document.createElement('div');
    counterDiv.id = 'guess-counter';
    counterDiv.style.margin = '12px 0 4px 0';
    counterDiv.style.fontWeight = 'bold';
    counterDiv.textContent = `Guesses left: ${guessCount}`;
    clueDisplay.appendChild(counterDiv);
    let stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop guessing';
    stopBtn.style.marginTop = '6px';
    clueDisplay.appendChild(stopBtn);
    let lastGuesses = [];
    stopBtn.onclick = function() {
      guessCount = 0;
      counterDiv.textContent = `Guesses left: 0`;
      removeGuessUI();
      showClueForm();
    };
    setTimeout(() => {
      // Both players can guess: always show guessing UI if clue exists
      const isEvenTurn = (gamedata.turn % 2 === 0);
      const statusArr = isEvenTurn ? window._codenamesStatus1 : window._codenamesStatus2;
      const cards = document.querySelectorAll('.codenames-card');
      const agentCounter = document.getElementById('agent-counter');
      function updateAgentCounter() {
        let unrevealed = 0;
        if (window._codenamesStatus1 && window._codenamesStatus2) {
          for (let i = 0; i < 25; i++) {
            if ((window._codenamesStatus1[i].status === 'agent' && window._codenamesStatus1[i].word !== '🕵️‍♂️') ||
                (window._codenamesStatus2[i].status === 'agent' && window._codenamesStatus2[i].word !== '🕵️‍♂️')) {
              unrevealed++;
            }
          }
        }
        if (agentCounter) agentCounter.textContent = `Agents remaining: ${unrevealed}`;

        // Check for win condition inside updateAgentCounter
        if (unguessedAgents === 0) {
          overlay.textContent = 'Congratulations, you win!';
          overlay.style.color = 'green';
          document.body.appendChild(overlay);

          // Update gamedata state to "win" and copy to clipboard
          const params = new URLSearchParams(window.location.search);
          const gamedata = JSON.parse(decodeURIComponent(params.get('gamedata')));
          const outData = JSON.parse(JSON.stringify(gamedata));
          outData.state = 'win';

          // Update status arrays to reflect all agents as guessed
          for (let i = 0; i < 25; i++) {
            if (window._codenamesStatus1[i] && window._codenamesStatus1[i].status === 'agent') {
              window._codenamesStatus1[i].word = '🕵️‍♂️';
            }
            if (window._codenamesStatus2[i] && window._codenamesStatus2[i].status === 'agent') {
              window._codenamesStatus2[i].word = '🕵️‍♂️';
            }
          }

          navigator.clipboard.writeText(JSON.stringify(outData));
          return;
        }
      }
      cards.forEach((card, i) => {
        card.style.cursor = 'pointer';
        card.onclick = function() {
          // Prevent clicking if already marked with this player's emoji
          let playerNum = isEvenTurn ? '2️⃣' : '1️⃣';
          if (
            guessCount > 0 &&
            card.textContent !== '🕶️' &&
            card.textContent !== '🕵️‍♂️' &&
            !(statusArr[i].status === 'bystander' && statusArr[i].word && statusArr[i].word.includes(playerNum))
          ) {
            const status = statusArr[i].status;
            if (status === 'agent') {
              card.textContent = '🕵️‍♂️';
              if (window._codenamesStatus1[i]) window._codenamesStatus1[i].word = '🕵️‍♂️';
              if (window._codenamesStatus2[i]) window._codenamesStatus2[i].word = '🕵️‍♂️';
              card.onclick = null;
              card.style.cursor = 'default';
              guessCount--;
              counterDiv.textContent = `Guesses left: ${guessCount}`;
              lastGuesses.push(i);
              updateAgentCounter();

              // Check for win condition immediately after guessing an agent
              let unguessedAgents = 0;
              if (turn % 2 === 1 && window._codenamesStatus2) {
                unguessedAgents = window._codenamesStatus2.filter(item => item.status === 'agent' && item.word !== '🕵️‍♂️').length;
              } else if (turn % 2 === 0 && window._codenamesStatus1) {
                unguessedAgents = window._codenamesStatus1.filter(item => item.status === 'agent' && item.word !== '🕵️‍♂️').length;
              }
              if (unguessedAgents === 0) {
                overlay.textContent = 'Congratulations, you win!';
                overlay.style.color = 'green';
                document.body.appendChild(overlay);

                // Update gamedata state to "win" and copy to clipboard
                const params = new URLSearchParams(window.location.search);
                const gamedata = JSON.parse(decodeURIComponent(params.get('gamedata')));
                const outData = JSON.parse(JSON.stringify(gamedata));
                outData.state = 'win';

                // Update status arrays to reflect all agents as guessed
                for (let i = 0; i < 25; i++) {
                  if (window._codenamesStatus1[i] && window._codenamesStatus1[i].status === 'agent') {
                    window._codenamesStatus1[i].word = '🕵️‍♂️';
                  }
                  if (window._codenamesStatus2[i] && window._codenamesStatus2[i].status === 'agent') {
                    window._codenamesStatus2[i].word = '🕵️‍♂️';
                  }
                }

                navigator.clipboard.writeText(JSON.stringify(outData));
                return;
              }
            } else if (status === 'bystander') {
              let newWord = statusArr[i].word + ' ' + playerNum;
              if (window._codenamesStatus1[i] && !window._codenamesStatus1[i].word.includes(playerNum)) window._codenamesStatus1[i].word = newWord;
              if (window._codenamesStatus2[i] && !window._codenamesStatus2[i].word.includes(playerNum)) window._codenamesStatus2[i].word = newWord;
              card.textContent = newWord;
              card.onclick = null;
              card.style.cursor = 'default';
              guessCount = 0;
              counterDiv.textContent = `Guesses left: 0`;
              lastGuesses.push(i);
              updateAgentCounter();
              removeGuessUI();
            } else if (status === 'assassin') {
              card.textContent += ' 💀';
              overlay.textContent = 'Game over, you lose.';
              overlay.style.backgroundColor = 'rgba(107, 0, 0, 0.6)';
              document.body.appendChild(overlay);

              // Update gamedata state to "lose" and copy to clipboard
              const params = new URLSearchParams(window.location.search);
              const gamedata = JSON.parse(decodeURIComponent(params.get('gamedata')));
              const outData = JSON.parse(JSON.stringify(gamedata));
              outData.state = 'lose';
              outData.turn += 1;
              navigator.clipboard.writeText(JSON.stringify(outData));
              return;
            }
            if (guessCount === 0) {
              updateAgentCounter();
              removeGuessUI();
              showClueForm();
            }
          }
        };
      });
    }, 0);
    function showClueForm() {
      clueForm.style.display = '';
    }
    function removeGuessUI() {
      clueDisplay.innerHTML = '';
    }
    window._codenamesLastGuesses = lastGuesses;
  }
  grid.innerHTML = '';
  // Always use the current status arrays for rendering (so emoji/word changes persist)
  const statusArr = (turn === 1 || turn % 2 === 1) ? window._codenamesStatus1 : window._codenamesStatus2;
  for (let i = 0; i < 25; i++) {
    const card = document.createElement('div');
    card.className = 'codenames-card';
    const status = statusArr[i].status;
    if (status === 'agent') card.classList.add('agent');
    if (status === 'assassin') card.classList.add('assassin');
    card.textContent = statusArr[i].word;
    grid.appendChild(card);
  }
  // Store generated words/status arrays for use on submit
  window._codenamesWords = words;
  window._codenamesStatus1 = status1;
  window._codenamesStatus2 = status2;

  // Add agent counter below player names (after words/status arrays are loaded)
  let agentCounter = document.getElementById('agent-counter');
  if (!agentCounter) {
    agentCounter = document.createElement('div');
    agentCounter.id = 'agent-counter';
    agentCounter.style.textAlign = 'center';
    agentCounter.style.fontWeight = 'bold';
    agentCounter.style.margin = '8px 0 8px 0';
    player2Label.parentNode.insertBefore(agentCounter, player2Label.nextSibling);
  }

  unrevealed = 0;
  for (let i = 0; i < 25; i++) {
    if ((status1[i].status === 'agent' && status1[i].word !== '🕵️‍♂️') ||
        (status2[i].status === 'agent' && status2[i].word !== '🕵️‍♂️')) {
      unrevealed++;
    }
  }

  agentCounter.textContent = `Agents remaining: ${unrevealed}`;

  // Show/hide clue form and clue display
  clueForm.style.display = (turn === 1 || !gamedata.clue) ? '' : 'none';
  clueDisplay.style.display = (turn === 1 || !gamedata.clue) ? 'none' : '';
}
  loadCodenamesWords();

  const clueForm = document.getElementById('clue-form');
  function handleClueFormSubmit(e) {
    e.preventDefault();
    const clueVal = document.getElementById('clue-input').value.trim();
    const countVal = parseInt(document.getElementById('count-input').value, 10);
    const params = new URLSearchParams(window.location.search);
    const gamedata = JSON.parse(decodeURIComponent(params.get('gamedata')));
    const outData = JSON.parse(JSON.stringify(gamedata));
    
    if (outData.turn === 1) {
      outData.data = window._codenamesWords;
    }
    outData.status1 = window._codenamesStatus1;
    outData.status2 = window._codenamesStatus2;
    outData.clue = { clue: clueVal, count: countVal };
    
    if (window._codenamesLastGuesses) {
      outData.lastGuesses = window._codenamesLastGuesses.map(idx => (window._codenamesWords ? window._codenamesWords[idx] : idx));
    }
    outData.turn += 1;
    navigator.clipboard.writeText(JSON.stringify(outData));
  }

  clueForm.addEventListener('submit', handleClueFormSubmit);
});