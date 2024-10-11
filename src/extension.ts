import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import moment from 'moment';

interface SessionData {
    workspace: string;
    date: string;
    duration: number;
    startTime: string;
    endTime: string;
}

let statusBarItem: vscode.StatusBarItem;
let startTime: moment.Moment | null = null;
let sessionData: SessionData[] = [];
let storageFilePath: string;

export function activate(context: vscode.ExtensionContext) {
    storageFilePath = path.join(context.globalStoragePath, 'sessionData.json');

    // Load existing session data
    loadSessionData();

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-analytics.showAnalytics', showAnalytics),
        vscode.commands.registerCommand('vscode-analytics.exportCSV', exportCSV)
    );

    // Start tracking immediately when VSCode is opened
    startTracking();

    // Stop tracking when the extension is deactivated
    context.subscriptions.push({
        dispose: stopTracking
    });
}

function startTracking() {
    if (!startTime) {
        startTime = moment();
        updateStatusBar();
    }
}

function stopTracking() {
    if (startTime) {
        const endTime = moment();
        const duration = endTime.diff(startTime, 'seconds');
        const workspace = vscode.workspace.name || 'Unknown';

        sessionData.push({
            workspace,
            date: startTime.format('YYYY-MM-DD'),
            duration,
            startTime: startTime.format('HH:mm:ss'),
            endTime: endTime.format('HH:mm:ss')
        });

        saveSessionData();
        startTime = null;
        statusBarItem.hide();
    }
}

function updateStatusBar() {
    if (startTime) {
        const duration = moment.duration(moment().diff(startTime));
        statusBarItem.text = `$(clock) ${formatDuration(duration.asSeconds())}`;
        statusBarItem.show();
        setTimeout(updateStatusBar, 1000);
    }
}

function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function loadSessionData() {
    try {
        if (fs.existsSync(storageFilePath)) {
            const data = fs.readFileSync(storageFilePath, 'utf8');
            sessionData = JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading session data:', error);
    }
}

function saveSessionData() {
    try {
        const dirPath = path.dirname(storageFilePath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(storageFilePath, JSON.stringify(sessionData));
    } catch (error) {
        console.error('Error saving session data:', error);
    }
}

function showAnalytics() {
    const panel = vscode.window.createWebviewPanel(
        'analyticsPanel',
        'VSCode Analytics',
        vscode.ViewColumn.One,
        {
            enableScripts: true
        }
    );

    panel.webview.html = getAnalyticsHtml();
    panel.webview.onDidReceiveMessage(
        message => {
            switch (message.command) {
                case 'getSessionData':
                    panel.webview.postMessage({ command: 'sessionData', data: sessionData });
                    break;
                case 'exportCSV':
                    exportCSV(message.filteredData);
                    break;
            }
        },
        undefined
    );
}


function getAnalyticsHtml() {
    // HTML content for the analytics panel
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>VSCode Analytics</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
                body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); background-color: var(--vscode-editor-background); }
                table { border-collapse: collapse; width: 100%; margin-top: 20px; }
                th, td { border: 1px solid var(--vscode-panel-border); padding: 8px; text-align: left; }
                th { background-color: var(--vscode-editor-background); }
                .filter-container { margin-bottom: 20px; display: flex; align-items: center; }
                .chart-container { display: flex; justify-content: space-between; margin-bottom: 20px; }
                .chart { width: 38%; }
                select, button { margin-right: 10px; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 10px; }
                select:hover, button:hover { background-color: var(--vscode-button-hoverBackground); }
            </style>
        </head>
        <body>
            <h1>VSCode Analytics</h1>
            <div class="filter-container">
                <select id="timeFilter">
                    <option value="all">All Time</option>
                    <option value="year">This Year</option>
                    <option value="month">This Month</option>
                    <option value="week">This Week</option>
                    <option value="today">Today</option>
                </select>
                <select id="projectFilter">
                    <option value="all">All Projects</option>
                </select>
                <button id="exportCsv">Export as CSV</button>
            </div>
            <div class="chart-container">
                <div class="chart">
                    <canvas id="pieChart"></canvas>
                </div>
            </div>
            <table id="dataTable">
                <thead>
                    <tr>
                        <th>Workspace</th>
                        <th>Date</th>
                        <th>Duration</th>
                        <th>Start Time</th>
                        <th>End Time</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
           <script>
                const vscode = acquireVsCodeApi();
                let sessionData = [];

                vscode.postMessage({ command: 'getSessionData' });

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'sessionData':
                            sessionData = message.data;
                            updateTable();
                            updateProjectFilter();
                            updateCharts();
                            break;
                    }
                });

                function updateTable() {
                    const tbody = document.querySelector('#dataTable tbody');
                    tbody.innerHTML = '';
                    const filteredData = filterData();
                    filteredData.sort((a, b) => new Date(b.date) - new Date(a.date));
                    filteredData.forEach(session => {
                        const row = tbody.insertRow();
                        row.insertCell().textContent = session.workspace;
                        row.insertCell().textContent = session.date;
                        row.insertCell().textContent = formatDuration(session.duration);
                        row.insertCell().textContent = session.startTime;
                        row.insertCell().textContent = session.endTime;
                    });
                }

                function updateProjectFilter() {
                    const projectFilter = document.getElementById('projectFilter');
                    const projects = [...new Set(sessionData.map(session => session.workspace))];
                    projects.forEach(project => {
                        const option = document.createElement('option');
                        option.value = project;
                        option.textContent = project;
                        projectFilter.appendChild(option);
                    });
                }

                function updateCharts() {
                    updatePieChart();
                }

               function updatePieChart() {
                    const ctx = document.getElementById('pieChart').getContext('2d');
                    const filteredData = filterData();
                    const groupedData = groupDataByWorkspace(filteredData);

                    new Chart(ctx, {
                        type: 'pie',
                        data: {
                            labels: Object.keys(groupedData),
                            datasets: [{
                                data: Object.values(groupedData).map(d => d / 3600),
                                backgroundColor: getRandomColors(Object.keys(groupedData).length)
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                tooltip: {
                                    callbacks: {
                                        label: function(context) {
                                            const label = context.label || '';
                                            const value = context.parsed;
                                            const duration = formatDuration(value * 3600);
                                            return \`\${label}: \${duration}\`;
                                        }
                                    }
                                }
                            }
                        }
                    });
                }

                function filterData() {
                    const timeFilter = document.getElementById('timeFilter').value;
                    const projectFilter = document.getElementById('projectFilter').value;
                    const now = new Date();

                    return sessionData.filter(session => {
                        const sessionDate = new Date(session.date);
                        const isInTimeRange = 
                            timeFilter === 'all' ||
                            (timeFilter === 'year' && sessionDate.getFullYear() === now.getFullYear()) ||
                            (timeFilter === 'month' && sessionDate.getMonth() === now.getMonth() && sessionDate.getFullYear() === now.getFullYear()) ||
                            (timeFilter === 'week' && isThisWeek(sessionDate)) ||
                            (timeFilter === 'today' && sessionDate.toDateString() === now.toDateString());

                        const isInProject = projectFilter === 'all' || session.workspace === projectFilter;

                        return isInTimeRange && isInProject;
                    });
                }

                function isThisWeek(date) {
                    const now = new Date();
                    const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
                    const weekEnd = new Date(now.setDate(now.getDate() - now.getDay() + 6));
                    return date >= weekStart && date <= weekEnd;
                }

                   function formatDuration(seconds) {
                    const hours = Math.floor(seconds / 3600);
                    const minutes = Math.floor((seconds % 3600) / 60);
                    const remainingSeconds = Math.floor(seconds % 60);
                    return \`\${hours}:\${minutes.toString().padStart(2, '0')}:\${remainingSeconds.toString().padStart(2, '0')}\`;
                }

                function getRandomColors(count) {
                    const colors = [];
                    for (let i = 0; i < count; i++) {
                        colors.push('#' + Math.floor(Math.random()*16777215).toString(16));
                    }
                    return colors;
                }

                function groupDataByWorkspace(data) {
                    return data.reduce((acc, session) => {
                        acc[session.workspace] = (acc[session.workspace] || 0) + session.duration;
                        return acc;
                    }, {});
                }

                document.getElementById('timeFilter').addEventListener('change', () => {
                    updateTable();
                    updateCharts();
                });

                document.getElementById('projectFilter').addEventListener('change', () => {
                    updateTable();
                    updateCharts();
                });

              document.getElementById('exportCsv').addEventListener('click', () => {
                    const filteredData = filterData();
                    vscode.postMessage({ command: 'exportCSV', filteredData: filteredData });
                });
            </script>
        </body>
        </html>
    `;
}

function exportCSV(filteredData: SessionData[]) {
    const csvContent = [
        ['Workspace', 'Date', 'Duration', 'Start Time', 'End Time'],
        ...filteredData.map(session => [
            session.workspace,
            session.date,
            formatDuration(session.duration),
            session.startTime,
            session.endTime
        ])
    ].map(row => row.join(',')).join('\n');

    vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('vscode-analytics-export.csv'),
        filters: {
            'CSV files': ['csv']
        }
    }).then(fileUri => {
        if (fileUri) {
            fs.writeFileSync(fileUri.fsPath, csvContent);
            vscode.window.showInformationMessage(`CSV exported to ${fileUri.fsPath}`);
        }
    });
}

export function deactivate() {
    stopTracking();
}