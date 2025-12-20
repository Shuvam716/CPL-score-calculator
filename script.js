// --- State Management ---
let matchState = {
    teams: {
        a: { name: '', players: [] },
        b: { name: '', players: [] }
    },
    config: {
        totalOvers: 10
    },
    innings: 1, // 1 or 2
    battingTeam: 'a', // 'a' or 'b'
    bowlingTeam: 'b',
    score: 0,
    wickets: 0,
    overs: 0, // Completed legal overs
    ballsInOver: 0, // Legal balls in current over
    currentOverHistory: [], // ['1', '4', 'W', '0'] etc
    ballHistory: [], // Full match log

    // Players on crease
    striker: null, // Index in players array
    nonStriker: null,
    bowler: null,

    // Stats storage (simplified)
    playerStats: {} // { 'TeamA_Player1': { runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, overs: 0, runsConceded: 0 } }
};

// Undo stack
let undoStack = [];

// DOM Elements
const views = {
    setup: document.getElementById('setup-view'),
    match: document.getElementById('match-view')
};

// --- Initialization ---

// Check if match exists in localStorage
/* 
// Commented out to force new match for demo/testing purposes easier. 
// In a real app, un-comment to enable persistence.
if(localStorage.getItem('cricket_match_state')) {
    matchState = JSON.parse(localStorage.getItem('cricket_match_state'));
    showView('match');
    updateUI();
}
*/

function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    views[viewName].classList.add('active-view');
}

// --- Setup Phase ---

document.getElementById('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const teamA = document.getElementById('team-a-name').value;
    const squadA = document.getElementById('team-a-squad').value.split('\n').filter(n => n.trim());
    const teamB = document.getElementById('team-b-name').value;
    const squadB = document.getElementById('team-b-squad').value.split('\n').filter(n => n.trim());
    const overs = parseInt(document.getElementById('total-overs').value);

    matchState.teams.a = { name: teamA, players: squadA };
    matchState.teams.b = { name: teamB, players: squadB };
    matchState.config.totalOvers = overs;

    // Init Stats
    [...squadA, ...squadB].forEach(p => {
        matchState.playerStats[p] = { runs: 0, balls: 0, fours: 0, sixes: 0, wickets: 0, overs: 0, runsConceded: 0, out: false };
    });

    // Initial Selection
    startInnings();
});

function startInnings() {
    // Determine batting/bowling team
    const batTeamKey = matchState.battingTeam;
    const bowlTeamKey = matchState.bowlingTeam;

    showView('match');

    // Prompt for Openers
    promptPlayerSelection(batTeamKey, 'Striker', (p1) => {
        matchState.striker = p1;
        promptPlayerSelection(batTeamKey, 'Non-Striker', (p2) => {
            matchState.nonStriker = p2;
            promptPlayerSelection(bowlTeamKey, 'Bowler', (p3) => {
                matchState.bowler = p3;
                updateUI();
                saveMatch();
            });
        });
    });
}

// --- Player Selection Logic ---

let currentSelectionCallback = null;

function promptPlayerSelection(teamKey, role, callback) {
    const modal = document.getElementById('player-modal');
    const title = document.getElementById('player-modal-title');
    const list = document.getElementById('player-select-list');

    title.innerText = `Select ${matchState.teams[teamKey].name} ${role}`;
    list.innerHTML = '';

    matchState.teams[teamKey].players.forEach(player => {
        // Filter out players who are already "out" or currently batting/bowling (except bowler who can rotate, but simpler logic here)
        // For simplicity: don't show currently active striker/non-striker again
        if (player === matchState.striker || player === matchState.nonStriker) return;
        if (matchState.playerStats[player].out) return;

        const btn = document.createElement('button');
        btn.className = 'btn-player-opt';
        btn.innerText = player;
        btn.onclick = () => {
            modal.classList.add('hidden');
            callback(player);
        };
        list.appendChild(btn);
    });

    modal.classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

// --- Scoring Logic ---

function addRun(runs) {
    pushUndoState();

    // Update Score
    matchState.score += runs;

    // Update Batsman Stats (if run scored by bat)
    const striker = matchState.playerStats[matchState.striker];
    striker.runs += runs;
    striker.balls++;
    if (runs === 4) striker.fours++;
    if (runs === 6) striker.sixes++;

    // Update Bowler Stats
    const bowler = matchState.playerStats[matchState.bowler];
    bowler.runsConceded += runs;

    // Record Ball
    recordBall(runs, false); // isExtra = false

    // Swap Strike if odd runs
    if (runs % 2 !== 0) swapStrike();

    advanceBall();
    updateUI();

    // Check Chase Win
    if (matchState.innings === 2 && matchState.score >= matchState.target) {
        endInnings();
    }
}

function openExtraModal(type) {
    const modal = document.getElementById('extras-modal');
    const container = document.getElementById('extras-options-container');
    const title = document.getElementById('extras-modal-title');

    container.innerHTML = '';

    if (type === 'wide') {
        title.innerText = "Wide Ball Options";
        createExtraBtn("Standard (1)", () => confirmExtra('wide', 0)); // 1 run total
        createExtraBtn("Wide + 4 (5)", () => confirmExtra('wide', 4)); // 5 runs total
    } else if (type === 'nb') {
        title.innerText = "No Ball Options";
        createExtraBtn("Standard (1)", () => confirmExtra('nb', 0)); // 1 run total
        createExtraBtn("NB + 1 Run", () => confirmExtra('nb', 1));
        createExtraBtn("NB + 2 Runs", () => confirmExtra('nb', 2));
        createExtraBtn("NB + 3 Runs", () => confirmExtra('nb', 3));
        createExtraBtn("NB + 4 Runs", () => confirmExtra('nb', 4));
        createExtraBtn("NB + 6 Runs", () => confirmExtra('nb', 6));
    } else if (type === 'bye') {
        title.innerText = "Bye Options";
        createExtraBtn("1 Bye", () => confirmExtra('bye', 1));
        createExtraBtn("2 Byes", () => confirmExtra('bye', 2));
        createExtraBtn("3 Byes", () => confirmExtra('bye', 3));
        createExtraBtn("4 Byes", () => confirmExtra('bye', 4));
    }

    modal.classList.remove('hidden');
}

function createExtraBtn(text, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn-wicket-opt'; // Reuse style
    btn.innerText = text;
    btn.onclick = onClick;
    document.getElementById('extras-options-container').appendChild(btn);
}

function confirmExtra(type, addedRuns) {
    closeModal('extras-modal');
    pushUndoState();

    if (type === 'wide') {
        // Wide (1) + addedRuns (e.g. 4)
        const total = 1 + addedRuns;
        matchState.score += total;
        matchState.playerStats[matchState.bowler].runsConceded += total;

        // Log
        const display = addedRuns > 0 ? `WD+${addedRuns}` : 'WD';
        matchState.currentOverHistory.push(display);
        matchState.ballHistory.push({
            over: matchState.overs, ball: matchState.ballsInOver,
            type: 'WD', runs: total,
            bowler: matchState.bowler, batsman: matchState.striker
        });

    } else if (type === 'nb') {
        // No Ball (1) + addedRuns (scored by batter or byes? Usually "NB+Runs" implies bat runs unless specified legbyes etc. Let's assume bat runs for simplicity in this context as "NB+4" usually means boundary off NB)
        const total = 1 + addedRuns;
        matchState.score += total;

        const bowler = matchState.playerStats[matchState.bowler];
        bowler.runsConceded += total;

        // If runs > 0, credit batsman?
        // Standard rule: 1 run for NB is extra. Runs scored off the bat are credited to batsman.
        if (addedRuns > 0) {
            matchState.playerStats[matchState.striker].runs += addedRuns;
            matchState.playerStats[matchState.striker].balls++; // Counts as ball faced? NB usually doesn't count as valid ball faced in some formats, but usually does for stats. Let's stick to standard: NB doesn't count as legal ball for over, but counts for records.
            if (addedRuns === 4) matchState.playerStats[matchState.striker].fours++;
            if (addedRuns === 6) matchState.playerStats[matchState.striker].sixes++;
        }
        // NB itself doesn't count as ball faced usually, but let's leave simply.
        matchState.playerStats[matchState.striker].balls++; // Record interaction

        const display = addedRuns > 0 ? `NB+${addedRuns}` : 'NB';
        matchState.currentOverHistory.push(display);
        matchState.ballHistory.push({
            over: matchState.overs, ball: matchState.ballsInOver,
            type: 'NB', runs: total,
            bowler: matchState.bowler, batsman: matchState.striker
        });

        // Swap strike if odd runs (runs off bat)
        if (addedRuns % 2 !== 0) swapStrike();

    } else if (type === 'bye') {
        // Byes are all team extras. 
        // Ball counts as legal.
        matchState.score += addedRuns;
        matchState.playerStats[matchState.striker].balls++; // Ball faced

        const display = `B${addedRuns}`;
        recordBall(display, true); // counts legal ball

        if (addedRuns % 2 !== 0) swapStrike();
        advanceBall();
    }

    updateUI();

    // Check Chase Win
    if (matchState.innings === 2 && matchState.score >= matchState.target) {
        endInnings();
    }
}

function recordBall(display, isExtra) {
    matchState.currentOverHistory.push(display);
    matchState.ballHistory.push({
        over: matchState.overs,
        ball: matchState.ballsInOver,
        type: isExtra ? 'EXT' : 'NOR',
        val: display,
        bowler: matchState.bowler,
        batsman: matchState.striker
    });
}

function advanceBall() {
    matchState.ballsInOver++;
    if (matchState.ballsInOver >= 6) {
        endOver();
    }
}

function endOver() {
    matchState.overs++;
    matchState.ballsInOver = 0;
    matchState.playerStats[matchState.bowler].overs++;
    matchState.currentOverHistory = [];
    swapStrike(); // End of over swap

    // Check match end
    if (matchState.overs >= matchState.config.totalOvers) {
        endInnings();
    } else {
        // New Bowler needed
        promptPlayerSelection(matchState.bowlingTeam, 'New Bowler', (p) => {
            matchState.bowler = p;
            updateUI();
        });
    }
}

function swapStrike() {
    let temp = matchState.striker;
    matchState.striker = matchState.nonStriker;
    matchState.nonStriker = temp;
}

// --- Wicket Logic ---

function openWicketModal() {
    document.getElementById('wicket-modal').classList.remove('hidden');
    document.getElementById('run-out-options').classList.add('hidden');
}

function initRunOut() {
    document.getElementById('run-out-options').classList.remove('hidden');
}

function confirmWicket(type, who) {
    pushUndoState();
    closeModal('wicket-modal');

    let outPlayer = matchState.striker;
    if (who === 'non-striker') outPlayer = matchState.nonStriker;

    // Update Stats
    matchState.playerStats[outPlayer].out = true;
    matchState.playerStats[outPlayer].balls++; // Wicket ball counts as faced

    matchState.wickets++;

    if (type !== 'run-out') {
        matchState.playerStats[matchState.bowler].wickets++;
    }

    recordBall('W', false);

    // Check All Out
    if (matchState.wickets >= matchState.teams[matchState.battingTeam].players.length - 1) {
        endInnings();
        return;
    }

    advanceBall(); // Ball counts

    // Select New Batsman
    promptPlayerSelection(matchState.battingTeam, 'New Batsman', (p) => {
        if (who === 'non-striker') {
            matchState.nonStriker = p;
        } else {
            matchState.striker = p;
        }
        updateUI();
    });
}

// --- Utils ---

function pushUndoState() {
    undoStack.push(JSON.parse(JSON.stringify(matchState)));
    if (undoStack.length > 5) undoStack.shift();
}

function undoLastBall() {
    if (undoStack.length === 0) return;
    matchState = undoStack.pop();
    updateUI();
}

function updateUI() {
    // Header
    const batTeam = matchState.teams[matchState.battingTeam];
    const bowTeam = matchState.teams[matchState.bowlingTeam];

    document.getElementById('batting-team-name').innerText = batTeam.name;
    document.getElementById('bowling-team-name').innerText = bowTeam.name;
    document.getElementById('score').innerText = matchState.score;
    document.getElementById('wickets').innerText = matchState.wickets;
    document.getElementById('wickets').innerText = matchState.wickets;
    document.getElementById('overs').innerText = `${matchState.overs}.${matchState.ballsInOver}`;
    document.getElementById('max-overs').innerText = matchState.config.totalOvers;

    if (matchState.innings === 2) {
        document.getElementById('target-display').classList.remove('hidden');
        const need = matchState.target - matchState.score;
        document.getElementById('target-score').innerText = `${matchState.target} (Need ${need})`;
    } else {
        document.getElementById('target-display').classList.add('hidden');
    }

    // Batsmen
    if (matchState.striker) {
        document.getElementById('striker-name').innerText = matchState.striker;
        const sStats = matchState.playerStats[matchState.striker];
        document.getElementById('striker-runs').innerText = sStats.runs;
        document.getElementById('striker-balls').innerText = sStats.balls;
    }

    if (matchState.nonStriker) {
        document.getElementById('non-striker-name').innerText = matchState.nonStriker;
        const nsStats = matchState.playerStats[matchState.nonStriker];
        document.getElementById('non-striker-runs').innerText = nsStats.runs;
        document.getElementById('non-striker-balls').innerText = nsStats.balls;
    }

    // Bowler
    if (matchState.bowler) {
        document.getElementById('bowler-name').innerText = matchState.bowler;
        const bStats = matchState.playerStats[matchState.bowler];
        document.getElementById('bowler-wickets').innerText = bStats.wickets;
        document.getElementById('bowler-runs').innerText = bStats.runsConceded;
        document.getElementById('bowler-overs').innerText = `${bStats.overs}.${matchState.ballsInOver}`;
    }

    // This Over
    const overContainer = document.getElementById('this-over-balls');
    overContainer.innerHTML = '';
    matchState.currentOverHistory.forEach(val => {
        const d = document.createElement('div');
        d.className = `ball-circle ball-${val}`;
        d.innerText = val;
        overContainer.appendChild(d);
    });

    saveMatch();
}

function saveMatch() {
    localStorage.setItem('cricket_match_state', JSON.stringify(matchState));
}

function endInnings() {
    if (matchState.innings === 1) {
        alert("End of 1st Innings! Target: " + (matchState.score + 1));

        // Save 1st Innings Data
        matchState.firstInningsData = {
            teamKey: matchState.battingTeam,
            score: matchState.score,
            wickets: matchState.wickets,
            overs: `${matchState.overs}.${matchState.ballsInOver}`
        };

        // Setup 2nd Innings
        matchState.innings = 2;
        matchState.target = matchState.score + 1;

        // Swap Teams
        let temp = matchState.battingTeam;
        matchState.battingTeam = matchState.bowlingTeam;
        matchState.bowlingTeam = temp;

        // Reset Scoreboard
        matchState.score = 0;
        matchState.wickets = 0;
        matchState.overs = 0;
        matchState.ballsInOver = 0;
        matchState.currentOverHistory = [];

        // Clear Crease
        matchState.striker = null;
        matchState.nonStriker = null;
        matchState.bowler = null;

        // Start 2nd Innings
        startInnings();

    } else {
        // Match Ended

        // Save 2nd Innings Data (Current state)
        matchState.secondInningsData = {
            teamKey: matchState.battingTeam,
            score: matchState.score,
            wickets: matchState.wickets,
            overs: `${matchState.overs}.${matchState.ballsInOver}`
        };

        let resultText = "";
        const teamBattingName = matchState.teams[matchState.battingTeam].name;
        const teamBowlingName = matchState.teams[matchState.bowlingTeam].name;

        if (matchState.score >= matchState.target) {
            resultText = `${teamBattingName} won by ${10 - matchState.wickets} wickets!`;
        } else if (matchState.score === matchState.target - 1) {
            resultText = "Match Tied!";
        } else {
            resultText = `${teamBowlingName} won by ${matchState.target - matchState.score - 1} runs!`;
        }

        document.getElementById('match-end-modal').classList.remove('hidden');
        document.getElementById('match-result-text').innerText = resultText;
    }
}

function generatePDF() {
    const element = document.getElementById('pdf-template');

    // Header
    const teamA = matchState.teams.a;
    const teamB = matchState.teams.b;

    document.getElementById('pdf-team-a').innerText = teamA.name;
    document.getElementById('pdf-team-b').innerText = teamB.name;

    // Scores in Header (Show Final Scores if available)
    let scoreTextA = "Didn't Bat";
    let scoreTextB = "Didn't Bat";

    // Helper to find data
    const getTeamData = (teamKey) => {
        if (matchState.firstInningsData && matchState.firstInningsData.teamKey === teamKey) return matchState.firstInningsData;
        if (matchState.secondInningsData && matchState.secondInningsData.teamKey === teamKey) return matchState.secondInningsData;
        // Fallback for current in-progress
        if (matchState.battingTeam === teamKey) return { score: matchState.score, wickets: matchState.wickets, overs: `${matchState.overs}.${matchState.ballsInOver}` };
        return null;
    };

    const dataA = getTeamData('a');
    if (dataA) scoreTextA = `${dataA.score}/${dataA.wickets} (${dataA.overs})`;

    const dataB = getTeamData('b');
    if (dataB) scoreTextB = `${dataB.score}/${dataB.wickets} (${dataB.overs})`;

    document.getElementById('pdf-score-a').innerText = scoreTextA;
    document.getElementById('pdf-score-b').innerText = scoreTextB;

    document.getElementById('pdf-result').innerText = document.getElementById('match-result-text').innerText;

    // --- Man of the Match Calculation ---
    let maxPoints = -1;
    let momName = "";
    let momStats = "";

    // Combine all players
    const allPlayers = [...matchState.teams.a.players, ...matchState.teams.b.players];

    allPlayers.forEach(p => {
        const stats = matchState.playerStats[p];
        const runPoints = Math.floor(stats.runs / 2);
        const wicketPoints = stats.wickets * 1; // 1 point per wicket as requested
        const totalPoints = runPoints + wicketPoints;

        if (totalPoints > maxPoints) {
            maxPoints = totalPoints;
            momName = p;
            momStats = `${totalPoints} Pts (${stats.runs} Runs, ${stats.wickets} Wkts)`;
        } else if (totalPoints === maxPoints) {
            // Simple tie-breaker or accumulation? Let's just append
            momName += ` & ${p}`;
        }
    });

    // Insert MoM Display
    const resultDiv = document.getElementById('pdf-result');
    resultDiv.innerHTML += `<div style="margin-top:10px; font-size:1.1rem; color:#d97706;">
        <span style="font-weight:bold;">Man of the Match:</span> ${momName} <br>
        <span style="font-size:0.9rem; color:#555;">${momStats}</span>
    </div>`;

    // -- Table Generators --

    const createBattingTable = (team) => {
        let html = `<h4 style="margin-top:15px; border-bottom:2px solid #333; padding-bottom:4px;">${team.name} Batting</h4>`;
        html += '<table style="width:100%; border-collapse: collapse; margin-bottom: 10px; font-size: 0.85rem;">';
        html += '<tr style="background:#f1f5f9; text-align:left;"><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>';

        team.players.forEach(p => {
            const stats = matchState.playerStats[p];
            // Only show players who played
            if (stats.balls > 0 || stats.out || p === matchState.striker || p === matchState.nonStriker) {
                const sr = stats.balls > 0 ? ((stats.runs / stats.balls) * 100).toFixed(1) : '0.0';
                html += `<tr>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0;">${p} ${stats.out ? '<span style="color:#ef4444; font-size:0.8em;">(out)</span>' : ''}</td>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0; font-weight:bold;">${stats.runs}</td>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0; color:#64748b;">${stats.balls}</td>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0;">${stats.fours}</td>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0;">${stats.sixes}</td>
                     <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0;">${sr}</td>
                </tr>`;
            }
        });
        html += '</table>';
        return html;
    };

    const createBowlingTable = (team) => {
        // 'team' is the bowling team
        let html = `<h5 style="margin-top:5px; color:#475569;">${team.name} Bowling</h5>`;
        html += '<table style="width:100%; border-collapse: collapse; margin-bottom: 20px; font-size: 0.85rem;">';
        html += '<tr style="background:#f1f5f9; text-align:left;"><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr>';

        let bowlersFound = false;
        team.players.forEach(p => {
            const stats = matchState.playerStats[p];
            // Check if bowled: has overs OR has runs conceded OR taken wickets
            if (stats.overs > 0 || stats.runsConceded > 0 || stats.wickets > 0) {
                bowlersFound = true;
                // Note: stats.overs is only completed overs. Ideally we'd calculate balls for exact stats, but using overs for now.
                const econ = stats.overs > 0 ? (stats.runsConceded / stats.overs).toFixed(2) : '-';
                html += `<tr>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0;">${p}</td>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0;">${stats.overs}</td>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0;">${stats.runsConceded}</td>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0; font-weight:bold;">${stats.wickets}</td>
                    <td style="padding:4px 8px; border-bottom:1px solid #e2e8f0;">${econ}</td>
                </tr>`;
            }
        });

        html += '</table>';
        return bowlersFound ? html : '';
    };

    let fullHtml = "";

    // Logic: 1st Innings (Team X Batting, Team Y Bowling) -> 2nd Innings (Team Y Batting, Team X Bowling)

    // 1st Innings Block
    if (matchState.firstInningsData) {
        const battingTeam = matchState.teams[matchState.firstInningsData.teamKey];
        const bowlingTeam = matchState.teams[matchState.firstInningsData.teamKey === 'a' ? 'b' : 'a'];

        fullHtml += `<div style="margin-bottom: 20px;">
            <h3 style="background:#e2e8f0; padding:5px;">Innings 1</h3>
            ${createBattingTable(battingTeam)}
            ${createBowlingTable(bowlingTeam)}
        </div>`;
    } else {
        // If 1st innings is still going on (or only 1st innings exists in state for some reason)
        const currentBat = matchState.teams[matchState.battingTeam];
        const currentBowl = matchState.teams[matchState.bowlingTeam];
        fullHtml += `<div style="margin-bottom: 20px;">
            <h3 style="background:#e2e8f0; padding:5px;">Innings 1 (Current)</h3>
            ${createBattingTable(currentBat)}
            ${createBowlingTable(currentBowl)}
        </div>`;
    }

    // 2nd Innings Block
    if (matchState.secondInningsData || matchState.innings === 2) {
        // Determine 2nd innings teams (inverse of 1st if completed, else use current)
        // Safer: if we are IN innings 2, use current. If match ended, use secondInningsData.

        let battingTeam, bowlingTeam;

        if (matchState.secondInningsData) {
            battingTeam = matchState.teams[matchState.secondInningsData.teamKey];
            bowlingTeam = matchState.teams[matchState.secondInningsData.teamKey === 'a' ? 'b' : 'a'];
        } else if (matchState.innings === 2) {
            battingTeam = matchState.teams[matchState.battingTeam];
            bowlingTeam = matchState.teams[matchState.bowlingTeam];
        }

        if (battingTeam) {
            fullHtml += `<div style="margin-bottom: 20px;">
                <h3 style="background:#e2e8f0; padding:5px;">Innings 2</h3>
                ${createBattingTable(battingTeam)}
                ${createBowlingTable(bowlingTeam)}
            </div>`;
        }
    }

    document.getElementById('pdf-scorecard-body').innerHTML = fullHtml;

    // Generate
    element.style.display = 'block';

    const opt = {
        margin: 0.3,
        filename: 'MatchReport.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save().then(() => {
        element.style.display = 'none';
        closeModal('match-end-modal');
    });
}
