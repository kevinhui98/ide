import { IS_PUTER } from "./puter.js";
import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";
const API_KEY = ""; // Get yours at https://platform.sulu.sh/apis/judge0


const AUTH_HEADERS = API_KEY
    ? {
        Authorization: `Bearer ${API_KEY}`,
    }
    : {};

let OPENROUTER_API_KEY = localStorage.getItem('OPENROUTER_API_KEY') || "";
function setOpenRouterApiKey(key) {
    OPENROUTER_API_KEY = key;
    localStorage.setItem('OPENROUTER_API_KEY', key);
}

const CE = "CE";
const EXTRA_CE = "EXTRA_CE";

const AUTHENTICATED_CE_BASE_URL = "https://judge0-ce.p.sulu.sh";
const AUTHENTICATED_EXTRA_CE_BASE_URL = "https://judge0-extra-ce.p.sulu.sh";

var AUTHENTICATED_BASE_URL = {};
AUTHENTICATED_BASE_URL[CE] = AUTHENTICATED_CE_BASE_URL;
AUTHENTICATED_BASE_URL[EXTRA_CE] = AUTHENTICATED_EXTRA_CE_BASE_URL;

const UNAUTHENTICATED_CE_BASE_URL = "https://ce.judge0.com";
const UNAUTHENTICATED_EXTRA_CE_BASE_URL = "https://extra-ce.judge0.com";

var UNAUTHENTICATED_BASE_URL = {};
UNAUTHENTICATED_BASE_URL[CE] = UNAUTHENTICATED_CE_BASE_URL;
UNAUTHENTICATED_BASE_URL[EXTRA_CE] = UNAUTHENTICATED_EXTRA_CE_BASE_URL;

const INITIAL_WAIT_TIME_MS = 0;
const WAIT_TIME_FUNCTION = (i) => 100;
const MAX_PROBE_REQUESTS = 50;

var fontSize = 13;

var layout;

var sourceEditor;
var stdinEditor;
var stdoutEditor;
var chatEditor;

var $selectLanguage;
var $compilerOptions;
var $commandLineArguments;
var $runBtn;
var $statusLine;
var $selectAi
var $sendChatBtn
var $chatInput
var $chatMessages
var selectedOption = 'Gemini'
var timeStart;

var sqliteAdditionalFiles;
var languages = {};

var layoutConfig = {
    settings: {
        showPopoutIcon: false,
        reorderEnabled: true,
    },
    content: [
        {
            type: "row",
            content: [
                {
                    type: "component",
                    width: 50,
                    componentName: "source",
                    id: "source",
                    title: "Source Code",
                    isClosable: false,
                    componentState: {
                        readOnly: false,
                    },
                },
                {
                    type: "column",
                    content: [
                        {
                            type: "component",
                            componentName: "stdin",
                            id: "stdin",
                            title: "Input",
                            isClosable: false,
                            componentState: {
                                readOnly: false,
                            },
                        },
                        {
                            type: "component",
                            componentName: "stdout",
                            id: "stdout",
                            title: "Output",
                            isClosable: false,
                            componentState: {
                                readOnly: true,
                            },
                        },
                    ],
                },
                {
                    type: "column",
                    content: [
                        {
                            type: "component",
                            componentName: "chat",
                            id: "chat",
                            title: "AI Chat",
                            isClosable: true,
                            componentState: {
                                readOnly: true,
                            },
                        },
                    ],
                },
            ],
        },
    ],
};

var gPuterFile;

function encode(str) {
    return btoa(unescape(encodeURIComponent(str || "")));
}

function decode(bytes) {
    var escaped = escape(atob(bytes || ""));
    try {
        return decodeURIComponent(escaped);
    } catch {
        return unescape(escaped);
    }
}

function showError(title, content) {
    $("#judge0-site-modal #title").html(title);
    $("#judge0-site-modal .content").html(content);

    let reportTitle = encodeURIComponent(`Error on ${window.location.href}`);
    let reportBody = encodeURIComponent(
        `**Error Title**: ${title}\n` +
        `**Error Timestamp**: \`${new Date()}\`\n` +
        `**Origin**: ${window.location.href}\n` +
        `**Description**:\n${content}`
    );

    $("#report-problem-btn").attr(
        "href",
        `https://github.com/judge0/ide/issues/new?title=${reportTitle}&body=${reportBody}`
    );
    $("#judge0-site-modal").modal("show");
}

function showHttpError(jqXHR) {
    showError(
        `${jqXHR.statusText} (${jqXHR.status})`,
        `<pre>${JSON.stringify(jqXHR, null, 4)}</pre>`
    );
}

function handleRunError(jqXHR) {
    showHttpError(jqXHR);
    $runBtn.removeClass("disabled");

    window.top.postMessage(
        JSON.parse(
            JSON.stringify({
                event: "runError",
                data: jqXHR,
            })
        ),
        "*"
    );
}

async function handleResult(data) {
    const tat = Math.round(performance.now() - timeStart);
    console.log(`It took ${tat}ms to get submission result.`);

    const status = data.status;
    const stdout = decode(data.stdout);
    const compileOutput = decode(data.compile_output);
    const time = data.time === null ? "-" : data.time + "s";
    const memory = data.memory === null ? "-" : data.memory + "KB";

    $statusLine.html(`${status.description}, ${time}, ${memory} (TAT: ${tat}ms)`);

    const output = [compileOutput, stdout].join("\n").trim();

    stdoutEditor.setValue(output);

    if (status.id === 6) {
        const SelectedLanguage = $selectLanguage.find(":selected").text();
        handleSyntaxError(sourceEditor.getValue(), SelectedLanguage, output);
    }

    $runBtn.removeClass("disabled");

    window.top.postMessage(
        JSON.parse(
            JSON.stringify({
                event: "postExecution",
                status: data.status,
                time: data.time,
                memory: data.memory,
                output: output,
            })
        ),
        "*"
    );
}
async function handleSyntaxError(sourceCode, language, error) {
    if (!OPENROUTER_API_KEY) {
        showError('API Key Required', 'Please set your OpenRouter API key in the Code Assistant pandel to get AI suggestions for syntax errors.')
        return
    }
    //Create a temporary marker to show we're processing
    const errorLineMatch = error.match(/error|Error on line (\d+)/)
    const errorLine = errorLineMatch ? parseInt(errorLineMatch[1]) : null

    if (errorLine) {
        sourceEditor.deltaDecorations([], [{
            range: new monaco.Range(errorLine, 1, errorLine, 1),
            options: {
                isWholeLine: true,
                className: 'errorHighlight',
                glyphMarginClassName: 'errorGlyphMargin'
            }
        }])
    }
    try {
        const prompt = `
        You are an expert programming assistant. A user has code that produced a syntax error. Analyze the code error, then provide a specific fix. Formet your response as a diff in the following format:
        
        ERROR_ANALYSIS:<brief explanation of the error>
        
        DIFF:
        <show only the lines that need to change, with - for removals and + for additions>
        
        EXPLAINATION: <brief explanation of the fix>
        
        Keep your response concise and focused on the specifi syntax error.`

        const models = {
            'Gemini': 'google/gemini-2.0-flash-thinking-exp:free',
            'Deepseek': 'deepseek/deepseek-r1:free',
            'Openai': 'openai/gpt-4o',
            'Llama': 'nvidia/llama-3.1-nemotron-70b-instruct:free',

        }
        const body = {
            model: models[selectedOption],
            messages: [
                {
                    role: "system",
                    content:
                        prompt,
                },
                {
                    role: "user",
                    content: `Language: ${language}\n\nCode:\n${sourceCode}\n\nError:\n${error}`,
                },
            ],
            stream: false
        };
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`)
        }
        const res = await response.json()
        const suggestion = res.choices[0].message.content
        const diffMatch = suggestion.match(/DIFF:\n([\s\S]*?)(?=\n\nEXPLANATION:|$)/)
        const explanationMatch = suggestion.match(/EXPLANATION:\x*([\s\S]*?)$/)
        if (diffMatch) {
            // Format the diff for display
            const formattedDiff = diffMatch[1]
                .split('\n')
                .map(line => {
                    if (line.startsWith('+')) {
                        return `<span class="text-[#51cf66]">${line}</span>`
                    } else if (line.startsWith('-')) {
                        return `<span class="text-[#ff6b6b]">${line}</span>`
                    }
                    return `<span class="text-[#8a8a8a]">${line}</span>`
                })
                .join('\n')
            const diffContainer = document.createElement('div')
            diffContainer.className = 'diff-suggestion bg-[#1e1e1e] p-4 rounded-lg border border-[#3e3e42] fixed bottom-4 right-4 w-96 shadow-lg'
            diffContainer.innerHTML = `
            <div class="diff-header flex justify-between items-center mb-2">
                <h3 class="text-[#cccccc] font-semibold"> Suggested Fix</h3>
                <div class="flex gap-2">
                    <button class="accept-diff bg-[#0078d4] hover:bg-[#006bb3] text-white px-3  py-1 rounded">Accept</button>
                    <button class="reject-diff bg-[#3e3e42] hover:bg-[#4e4e52] text-white px-3  py-1 rounded">Reject</button>
                </div>
            </div>
            <pre class="diff-content text-sm font-mono text-[#cccccc] overflow-x-auto whitespace-pre">${formattedDiff}</pre>
            ${explanationMatch ? `<p class="mt-2 text0sm text-[#8a8a8a]"> ${explanationMatch[1]}</p>` : ''}
            `
            // Remove any existing diff suggestions
            const existingDiff = document.querySelector('.diff-suggestion')
            if (existingDiff) { existingDiff.remove(); }
            document.body.appendChild(diffContainer);
            console.log(diffContainer)
            console.log(diffContainer.querySelector('.accept-diff'))
            diffContainer.querySelector('.accept-diff').addEventListener('click', () => {
                const diff = diffMatch[1]
                console.log('Raw diff:', diff)

                // Split into lines and clean up
                const lines = diff.split('\n')
                    .map(line => line.trimEnd()) // Keep leading whitespace, remove trailing
                    .filter(line => line.length > 0) // Remove empty lines

                console.log("parsed lines:", lines)

                let currentCode = sourceEditor.getValue().split('\n')
                console.log('Current code lines:', currentCode)

                // Group the changes by finding consecutive - and + lines
                let changes = []
                let currentChanges = { removals: [], additions: [] }
                lines.forEach(line => {
                    if (line.startsWith('-')) {
                        currentChanges.removals.push(line.substring(1))
                    } else if (line.startsWith('+')) {
                        currentChanges.additions.push(line.substring(1))
                    } else {
                        // Context line - if we have a current change, save it and starta new one
                        if (currentChanges.removals.length > 0 || currentChanges.additions.length > 0) {
                            changes.push(currentChanges)
                            currentChanges = { removals: [], additions: [] }
                        }
                    }
                })

                if (currentChanges.removals.length > 0 || currentChanges.additions.length > 0) {
                    changes.push(currentChanges)
                }
                console.log('Grouped changes:', changes)

                changes.forEach(change => {
                    // Find where to apply the change
                    let targetLine = -1
                    // first try to find the line to replace
                    if (change.removals.length > 0) {
                        // Look for the first line to remove
                        const lineToFind = change.removals[0]
                        targetLine = currentCode.findIndex(
                            codeLine => {
                                codeLine.trim() === lineToFind.trim()
                            }
                        )
                    }
                    // If we couldn't find the line and we have an error line, use that
                    if (targetLine === -1 && errorLine) {
                        targetLine = errorLine - 1
                    }
                    // If we found a place to make changes
                    if (targetLine !== -1) {
                        console.log('Applying change at line:', targetLine)
                        console.log('Removing lines:', change.removals)
                        console.log('Adding lines:', change.additions)

                        // Remove the old line
                        if (change.removals.length > 0) {
                            currentCode.splice(targetLine, change.removals.length)
                        }
                        if (change.additions.length > 0) {
                            currentCode.splice(targetLine, 0, ...change.additions)
                        }
                    } else {
                        console.log('Could not find target line for change')
                    }
                })
                // Apply the changes
                const newContent = currentCode.join('\n')
                console.log('new content:', newContent)
                sourceEditor.setValue(newContent)

                // Remove the diff view
                diffContainer.remove()
            })
            diffContainer.querySelector('.reject-diff').addEventListener('click', () => {
                diffContainer.remove()
            })
        }
    } catch (error) {
        console.error('Error getting suggestion:', error)
        showError('Error', 'Failed to get code suggestion. Please check your OpenRouter API key and try again')
    }
}
async function getSelectedLanguage() {
    return getLanguage(getSelectedLanguageFlavor(), getSelectedLanguageId());
}

function getSelectedLanguageId() {
    return parseInt($selectLanguage.val());
}

function getSelectedLanguageFlavor() {
    return $selectLanguage.find(":selected").attr("flavor");
}

function run() {
    if (sourceEditor.getValue().trim() === "") {
        showError("Error", "Source code can't be empty!");
        return;
    } else {
        $runBtn.addClass("disabled");
    }

    stdoutEditor.setValue("");
    $statusLine.html("");

    let x = layout.root.getItemsById("stdout")[0];
    x.parent.header.parent.setActiveContentItem(x);

    let sourceValue = encode(sourceEditor.getValue());
    let stdinValue = encode(stdinEditor.getValue());
    let languageId = getSelectedLanguageId();
    let compilerOptions = $compilerOptions.val();
    let commandLineArguments = $commandLineArguments.val();

    let flavor = getSelectedLanguageFlavor();

    if (languageId === 44) {
        sourceValue = sourceEditor.getValue();
    }

    let data = {
        source_code: sourceValue,
        language_id: languageId,
        stdin: stdinValue,
        compiler_options: compilerOptions,
        command_line_arguments: commandLineArguments,
        redirect_stderr_to_stdout: true,
    };

    let sendRequest = function (data) {
        window.top.postMessage(
            JSON.parse(
                JSON.stringify({
                    event: "preExecution",
                    source_code: sourceEditor.getValue(),
                    language_id: languageId,
                    flavor: flavor,
                    stdin: stdinEditor.getValue(),
                    compiler_options: compilerOptions,
                    command_line_arguments: commandLineArguments,
                })
            ),
            "*"
        );

        timeStart = performance.now();
        $.ajax({
            url: `${AUTHENTICATED_BASE_URL[flavor]}/submissions?base64_encoded=true&wait=false`,
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify(data),
            headers: AUTH_HEADERS,
            success: function (data, textStatus, request) {
                console.log(`Your submission token is: ${data.token}`);
                let region = request.getResponseHeader("X-Judge0-Region");
                setTimeout(
                    fetchSubmission.bind(null, flavor, region, data.token, 1),
                    INITIAL_WAIT_TIME_MS
                );
            },
            error: handleRunError,
        });
    };

    if (languageId === 82) {
        if (!sqliteAdditionalFiles) {
            $.ajax({
                url: `./data/additional_files_zip_base64.txt`,
                contentType: "text/plain",
                success: function (responseData) {
                    sqliteAdditionalFiles = responseData;
                    data["additional_files"] = sqliteAdditionalFiles;
                    sendRequest(data);
                },
                error: handleRunError,
            });
        } else {
            data["additional_files"] = sqliteAdditionalFiles;
            sendRequest(data);
        }
    } else {
        sendRequest(data);
    }
}

function fetchSubmission(flavor, region, submission_token, iteration) {
    if (iteration >= MAX_PROBE_REQUESTS) {
        handleRunError(
            {
                statusText: "Maximum number of probe requests reached.",
                status: 504,
            },
            null,
            null
        );
        return;
    }

    $.ajax({
        url: `${UNAUTHENTICATED_BASE_URL[flavor]}/submissions/${submission_token}?base64_encoded=true`,
        headers: {
            "X-Judge0-Region": region,
        },
        success: function (data) {
            if (data.status.id <= 2) {
                // In Queue or Processing
                $statusLine.html(data.status.description);
                setTimeout(
                    fetchSubmission.bind(
                        null,
                        flavor,
                        region,
                        submission_token,
                        iteration + 1
                    ),
                    WAIT_TIME_FUNCTION(iteration)
                );
            } else {
                handleResult(data);
            }
        },
        error: handleRunError,
    });
}

function setSourceCodeName(name) {
    $(".lm_title")[0].innerText = name;
}

function getSourceCodeName() {
    return $(".lm_title")[0].innerText;
}

function openFile(content, filename) {
    clear();
    sourceEditor.setValue(content);
    selectLanguageForExtension(filename.split(".").pop());
    setSourceCodeName(filename);
}

function saveFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

async function openAction() {
    if (IS_PUTER) {
        gPuterFile = await puter.ui.showOpenFilePicker();
        openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
    } else {
        document.getElementById("open-file-input").click();
    }
}

async function llmInLineChat(wholeCode, highlightedCode, query) {
    const prompt = `
          You are a senior software engineer with expertise in multiple programming languages. Your task is to analyze the following segment of code and the whole code from which that segment code belongs to. Provide a detailed yet concise response to the question/comment that the user has.
  
          Question/Comment:
          ${query}
  
          Segment of Code:
          ${highlightedCode}
  
          Whole Code:
          ${wholeCode}
  
          Please provide:
          1. One second analysis for segment of code in regard tot he whole code.
          2. Direct answer to the comment/question.
  
          Note: Be concise and clear. No hallucinations.
          Lets think about this line by line
      `;

    const models = {
        'Gemini': 'google/gemini-2.0-flash-thinking-exp:free',
        'Deepseek': 'deepseek/deepseek-r1:free',
        'Openai': 'openai/gpt-4o',
        'Llama': 'nvidia/llama-3.1-nemotron-70b-instruct:free',

    }
    const body = {
        model: models[selectedOption],
        messages: [
            {
                role: "system",
                content:
                    "You are a senior software engineer with expertise in multiple programming languages.",
            },
            {
                role: "user",
                content: prompt,
            },
        ]
    };
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        const res = await response.json()
        console.log(res.choices[0].message.content)
        return res.choices[0].message.content
    } catch (error) {
        console.error('new error', error)
    }
    //returns a array still need get the message from choices
}

async function sendButtonClicked() {
    console.log("Button clicked");
    const userInput = document.getElementById("chat-field").value;
    console.log(userInput);
    // Disable editing specification_id, version, and app values
    // const select = sourceEditor.createDecorationsCollection([
    //     {
    //         range: new monaco.Range(1, 0, 3, 0), // Block lines 1 to 3
    //         options: {
    //             isWholeLine: true,
    //             className: 'editor-line-readonly',
    //         },
    //     },
    // ]);
    // // Disable line editing (handled from the CSS side but here as well to be safe)
    // sourceEditor.onKeyDown(e => {
    //     const isInBlockedRange = sourceEditor
    //         .getSelections()
    //         ?.findIndex(range => new monaco.Range(1, 0, 4, 0).intersectRanges(range)) !== -1;  // Block lines 1 to 3
    //     if (isInBlockedRange) {
    //         e.stopPropagation();
    //         e.preventDefault();
    //     }
    //     console.log(isInBlockedRange)
    // });

    const code = sourceEditor.getValue().trim();
    console.log("Source editor text: ", code);
    const newHTMLElement = document.createElement("p");
    newHTMLElement.innerText = userInput;
    document.getElementById("chat-messages").appendChild(newHTMLElement);
    document.getElementById("chat-field").value = "";
    const llmResponse = await callLLM(userInput, code, selectedOption);
    console.log(llmResponse)
    // for await (var chunk of llmResponse.body) {
    //     console.log(chunk)
    const llmHTMLElement = document.createElement("p");
    llmHTMLElement.innerText = llmResponse.choices[0].message.content;
    document.getElementById("chat-messages").appendChild(llmHTMLElement);
    // }
    // const reader = llmResponse.body.getReader();
    // const decoder = new TextDecoder();
    // while (true) {
    //     const { done, value } = await reader.read();
    //     if (done) {
    //         break;
    //     }
    //     const text = decoder.decode(value);
    //     const llmHTMLElement = document.createElement("p");
    //     llmHTMLElement.innerHTML += text;
    //     console.log(text)
    //     document.getElementById("chat-messages").appendChild(llmHTMLElement);
    // }
}

async function saveAction() {
    if (IS_PUTER) {
        if (gPuterFile) {
            gPuterFile.write(sourceEditor.getValue());
        } else {
            gPuterFile = await puter.ui.showSaveFilePicker(
                sourceEditor.getValue(),
                getSourceCodeName()
            );
            setSourceCodeName(gPuterFile.name);
        }
    } else {
        saveFile(sourceEditor.getValue(), getSourceCodeName());
    }
}

function setFontSizeForAllEditors(fontSize) {
    sourceEditor.updateOptions({ fontSize: fontSize });
    stdinEditor.updateOptions({ fontSize: fontSize });
    stdoutEditor.updateOptions({ fontSize: fontSize });
}

async function loadLangauges() {
    return new Promise((resolve, reject) => {
        let options = [];

        $.ajax({
            url: UNAUTHENTICATED_CE_BASE_URL + "/languages",
            success: function (data) {
                for (let i = 0; i < data.length; i++) {
                    let language = data[i];
                    let option = new Option(language.name, language.id);
                    option.setAttribute("flavor", CE);
                    option.setAttribute(
                        "langauge_mode",
                        getEditorLanguageMode(language.name)
                    );

                    if (language.id !== 89) {
                        options.push(option);
                    }

                    if (language.id === DEFAULT_LANGUAGE_ID) {
                        option.selected = true;
                    }
                }
            },
            error: reject,
        }).always(function () {
            $.ajax({
                url: UNAUTHENTICATED_EXTRA_CE_BASE_URL + "/languages",
                success: function (data) {
                    for (let i = 0; i < data.length; i++) {
                        let language = data[i];
                        let option = new Option(language.name, language.id);
                        option.setAttribute("flavor", EXTRA_CE);
                        option.setAttribute(
                            "langauge_mode",
                            getEditorLanguageMode(language.name)
                        );

                        if (
                            options.findIndex((t) => t.text === option.text) === -1 &&
                            language.id !== 89
                        ) {
                            options.push(option);
                        }
                    }
                },
                error: reject,
            }).always(function () {
                options.sort((a, b) => a.text.localeCompare(b.text));
                $selectLanguage.append(options);
                resolve();
            });
        });
    });
}

async function loadSelectedLanguage(skipSetDefaultSourceCodeName = false) {
    monaco.editor.setModelLanguage(
        sourceEditor.getModel(),
        $selectLanguage.find(":selected").attr("langauge_mode")
    );

    if (!skipSetDefaultSourceCodeName) {
        setSourceCodeName((await getSelectedLanguage()).source_file);
    }
}
function selectLanguageByFlavorAndId(languageId, flavor) {
    let option = $selectLanguage.find(`[value=${languageId}][flavor=${flavor}]`);
    if (option.length) {
        option.prop("selected", true);
        $selectLanguage.trigger("change", { skipSetDefaultSourceCodeName: true });
    }
}

function selectLanguageForExtension(extension) {
    let language = getLanguageForExtension(extension);
    selectLanguageByFlavorAndId(language.language_id, language.flavor);
}

async function getLanguage(flavor, languageId) {
    return new Promise((resolve, reject) => {
        if (languages[flavor] && languages[flavor][languageId]) {
            resolve(languages[flavor][languageId]);
            return;
        }

        $.ajax({
            url: `${UNAUTHENTICATED_BASE_URL[flavor]}/languages/${languageId}`,
            success: function (data) {
                if (!languages[flavor]) {
                    languages[flavor] = {};
                }

                languages[flavor][languageId] = data;
                resolve(data);
            },
            error: reject,
        });
    });
}

function setDefaults() {
    setFontSizeForAllEditors(fontSize);
    sourceEditor.setValue(DEFAULT_SOURCE);
    stdinEditor.setValue(DEFAULT_STDIN);
    $compilerOptions.val(DEFAULT_COMPILER_OPTIONS);
    $commandLineArguments.val(DEFAULT_CMD_ARGUMENTS);

    $statusLine.html("");

    loadSelectedLanguage();
}

function clear() {
    sourceEditor.setValue("");
    stdinEditor.setValue("");
    $compilerOptions.val("");
    $commandLineArguments.val("");

    $statusLine.html("");
}

function refreshSiteContentHeight() {
    const navigationHeight = document.getElementById(
        "judge0-site-navigation"
    ).offsetHeight;

    const siteContent = document.getElementById("judge0-site-content");
    siteContent.style.height = `${window.innerHeight}px`;
    siteContent.style.paddingTop = `${navigationHeight}px`;
}

function refreshLayoutSize() {
    refreshSiteContentHeight();
    layout.updateSize();
}

window.addEventListener("resize", refreshLayoutSize);
document.addEventListener("DOMContentLoaded", async function () {
    $("#select-language").dropdown();
    $("[data-content]").popup({
        lastResort: "left center",
    });

    refreshSiteContentHeight();

    console.log(
        "Hey, Judge0 IDE is open-sourced: https://github.com/judge0/ide. Have fun!"
    );

    $selectLanguage = $("#select-language");
    $selectLanguage.change(function (event, data) {
        let skipSetDefaultSourceCodeName =
            (data && data.skipSetDefaultSourceCodeName) || !!gPuterFile;
        loadSelectedLanguage(skipSetDefaultSourceCodeName);
    });

    await loadLangauges();

    $compilerOptions = $("#compiler-options");
    $commandLineArguments = $("#command-line-arguments");

    $runBtn = $("#run-btn");
    $runBtn.click(run);

    $("#open-file-input").change(function (e) {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = function (e) {
                openFile(e.target.result, selectedFile.name);
            };

            reader.onerror = function (e) {
                showError("Error", "Error reading file: " + e.target.error);
            };

            reader.readAsText(selectedFile);
        }
    });
    $('#select-ai').dropdown();
    // Get the selected option within the select tag which is also updated on change
    $selectAi = $('#select-ai');
    $selectAi.change(function () {
        selectedOption = $selectAi.find(":selected").id;
        console.log("Selected AI:", selectedOption);
    });
    $selectAi = $('#select-ai');

    $statusLine = $("#judge0-status-line");

    $(document).on("keydown", "body", function (e) {
        if (e.metaKey || e.ctrlKey) {
            switch (e.key) {
                case "Enter": // Ctrl+Enter, Cmd+Enter
                    e.preventDefault();
                    run();
                    break;
                case "s": // Ctrl+S, Cmd+S
                    e.preventDefault();
                    save();
                    break;
                case "o": // Ctrl+O, Cmd+O
                    e.preventDefault();
                    open();
                    break;
                case "+": // Ctrl+Plus
                case "=": // Some layouts use '=' for '+'
                    e.preventDefault();
                    fontSize += 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "-": // Ctrl+Minus
                    e.preventDefault();
                    fontSize -= 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "0": // Ctrl+0
                    e.preventDefault();
                    fontSize = 13;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "k":
                    e.preventDefault();
                    fontSize += 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
            }
        }
    });

    require(["vs/editor/editor.main"], function (ignorable) {
        layout = new GoldenLayout(layoutConfig, $("#judge0-site-content"));

        layout.registerComponent("source", function (container, state) {
            sourceEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: true,
                readOnly: state.readOnly,
                language: "cpp",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: true,
                },
            });

            sourceEditor.addCommand(
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
                run
            );
        });

        layout.registerComponent("stdin", function (container, state) {
            stdinEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: false,
                },
            });
        });

        layout.registerComponent("stdout", function (container, state) {
            stdoutEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: false,
                },
            });
        });

        layout.registerComponent("chat", function (container, state) {
            const chatContainer = document.createElement("div")
            chatContainer.className = "chat-container h-pull flex flex-col bg-[#1e1e1e] my-4"
            chatContainer.innerHTML =
                `<div class="chat-header bg-[#252526] border-b border-[#3e3e42] p-4">
                    <div class="chat-header-content space-y-1">
                        <h3 style ="color: #cccccc">Code Assistant</h3>
                        <div class="flex item-center gap-2">
                            <input type="password" id="openrouter-api-key"
                            class="flex-1 bg-[#1e1e1e] text-[#cccccc] text-sm rounded border border-[#3e3e42] px-2 py-1 focus:outline-none focus:border-[@0078d4]" placeholder="Enter OpenRouter API Key" value="${OPENROUTER_API_KEY}" />
                            <button id="save-api-key" class="bg-[#0078d4] hover:bg-[#006bb3] text-white text-sm px-2 py-1 rounded transition-colors">Save Key</button>
                        </div>
                        <p class="chat-description" style="font-size:smaller; color: #8a8a8a;"> Ask questions about your code or get help with programming</p>
                    </div>
                </div>
                <div id="chat-messages" class="messages flex-1 overflow-y-scroll p-4 space-y-4 max-h-[40%]"></div>
                <div class="chat-input-container border-t border-[#3e3e42] p-4 bg-[#252526]">
                    <div class="chat-input-wrapper flex gap-2">
                        <textarea id="chat-field" class="chat-input flex-1 bg-[#1e1e1e] text-[#cccccc] rounded-lg border border-[#3e3e42] p-3 focus:outline-none focus:border-[#0078d4] w-[80px]" rows='1' placeholder="Type here to chat with us!" ></textarea>
                        <button id="chat-button" class="send-btn bg-[#0078d4] hover:bg-[006bb3] text-white px-4 py-2 rounded-lg flex items-center transition-colors ui primary button">Send</button>
                    </div>
                </div>
          `

            // container.getElement().append(chatEditor);
            // $chatMessages = chatEditor.find("#chat-messages");
            // $chatInput = chatEditor.find("#chat-field");
            const inputEl = chatContainer.querySelector('textarea')
            const messagesEl = chatContainer.querySelector('#chat-messages')
            const sendBtn = chatContainer.querySelector('#chat-button')

            // Auto-resize textarea as user types
            inputEl.addEventListener('input', function () {
                this.style.height = 'auto'
                this.style.height = Math.min(this.scrollHeight, 75) + 'px'
            })
            function formatTimestamp() {
                const now = new Date()
                return now.toLocaleDateString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                })
            }
            function addUserMessage(message) {
                const messageHTML = `
                    <div class="message-wrapper user-message-wrapper flex justify-end">
                        <div class="message user-message bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2 max-w-[80%]">
                            <div class="message-content">${message}</div>
                            <div class="message timestamp text-xs text-[#8a8a8a] mt-1">${formatTimestamp()}</div>
                        </div>
                    </div>
                `
                messagesEl.insertAdjacentHTML('beforeend', messageHTML)
                messagesEl.scrollTop = messagesEl.scrollHeight
            }
            function addAssistantMessage(message) {
                const messageHTML = `
                    <div class="message-wrapper assistant-message-wrapper flex justify-start">
                        <div class="message assistant-message bg-[#252526] text-[#cccccc] rounded2xl rounded-tl-sm px-4 py-2 max-w-[80%]">
                            <div class="message-content">${message}</div>
                            <div class="message-timestamp text-xs text-[#8a8a8a] mt-1">${formatTimestamp()}</div>
                        </div>
                    </div>
                `
                messagesEl.insertAdjacentHTML('beforeend', messageHTML)
                messagesEl.scrollTop = messagesEl.scrollHeight
            }
            function addTypingIndicator() {
                const indicatorHTML = `
                <div class="message-wrapper assistant-message-wraper flex justify-start" id="typing-indicator">
                    <div class="message assistant-message bg-[#252526] text-[#cccccc] roudned 2xl rounded-tl-sm px-4 py-2">
                        <div class="typing-indicator flex gap-1">
                            <div class="typing-dot w-2 h-2 bg-[#8a8a8a] rounded-full animate-bounce"></div>
                            <div class="typing-dot w-2 h-2 bg-[#8a8a8a] rounded-full animate-bounce" style="animation-deplay: 0.2s"></div>
                            <div class="typing-dot w-2 h-2 bg-[#8a8a8a] rounded-full animate-bounce" style="animation-deplay: 0.2s"></div>
                        </div>
                    </div>
                </div>
                `
                messagesEl.insertAdjacentHTML('beforeend', indicatorHTML)
                messagesEl.scrollTop = messagesEl.scrollHeight
            }
            function removeTypingIndicator() {
                const indicator = messagesEl.querySelector('#typing-indicator')
                if (indicator) indicator.remove()
            }
            async function callLLM(option = 'Gemini') {
                const message = inputEl.value.trim()
                if (!message) return
                inputEl.value = ""
                inputEl.style.height = '56px'
                console.log(message)
                addUserMessage(message)
                addTypingIndicator()
                const codeContext = {
                    source_code: sourceEditor.getValue(),
                    languages: $selectLanguage.find(":selected").text(),
                    stdin: stdinEditor.getValue(),
                    stdout: stdoutEditor.getValue()
                }
                const prompt = `
                    You are a senior software engineer with expertise in multiple programming languages. you have access to the following code context:
                    Langauge: ${codeContext.languages}
                    Source Code: 
                    \`\`\`
                    ${codeContext.source_code}
                    \`\`\`
                    ${codeContext.stdin ? `Input:\n$(codeContext.stdin)\n` : ''}
                    ${codeContext.stdout ? `Output:\n$(codeContext.stdout)\n` : ''}
            
                    Please provide:
                    1. A brief analysis of the code.
                    2. Specific improvements or optimizations that can be made.
                    3. Any best practices or design patterns that could be applied.
                    4. If applicable, provide an example of improved code.

                    let take this step by step
                `;

                const models = {
                    'Gemini': 'google/gemini-2.0-flash-thinking-exp:free',
                    'Deepseek': 'deepseek/deepseek-r1:free',
                    'Openai': 'openai/gpt-4o',
                    'Llama': 'nvidia/llama-3.1-nemotron-70b-instruct:free',

                }
                const body = {
                    model: models[option],
                    messages: [
                        {
                            role: "system",
                            content:
                                prompt,
                        },
                        {
                            role: "user",
                            content: `Here is what the user said:
                            <User_message>${message}</user_message>
                            
                            Provide a detailed and accurate response to the user's message based on the code context. If suggesting code changes, explain the reasoning and ensure they follow best practices.`,
                        },
                    ],
                    stream: false
                };
                try {
                    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(body),
                    });
                    if (!response.ok) {
                        throw new Error(`API request Failed: ${response.statusText}`)
                    }
                    const res = await response.json()
                    console.log(res)
                    removeTypingIndicator()
                    addAssistantMessage(marked.parse(res.choices[0].message.content))

                } catch (error) {
                    removeTypingIndicator()
                    addAssistantMessage("Sorry, there was an error processing your request.")
                }
                // .then((response) => {
                //     const reader = response.body.getReader();
                //     reader.read().then(function pump({ done, value }) {
                //         if (done) { 
                //             return ;
                //         }

                //         return reader.read().then(pump);
                //     })
                // }).catch((err) => console.log(err))
                // we have a readable stream that sends the data to the client
                // const reader = response.body.getReader();
                // const streamer = reader.read().then(async function pump({ done, value }) {
                //     if (done) {
                //         return;
                //     }
                //     async start(controller) {
                //         const encoder = new TextEncoder();
                //         try {
                //             for await (const chunk of completion) {
                //                 const content = chunk.choices[0]?.delta?.content
                //                 if (content) {
                //                     const text = encoder.encode(content);
                //                     controller.enqueue(text);
                //                 }
                //             }
                //         } catch (error) {
                //             console.error(error);
                //         } finally {
                //             // we need to close the stream when we are done
                //             controller.close();
                //         }
                //     }
                //     return reader.read().then(pump);
                // })
                // const stream = new ReadableStream({
                //     // we use async so this doesn't stall the main thread while waiting for data. we can have multiple connection at the same time
                //     async start(controller) {
                //         const encoder = new TextEncoder();
                //         try {
                //             console.log(response.body)
                //             for await (const chunk of response.body) {
                //                 const content = chunk.choices[0]?.delta?.content
                //                 if (content) {
                //                     const text = encoder.encode(content);
                //                     controller.enqueue(text);
                //                 }
                //             }
                //         } catch (error) {
                //             console.error(error);
                //         } finally {
                //             // we need to close the stream when we are done
                //             controller.close();
                //         }
                //     }
                // });

                // const reader = response.body.getReader();

                // const stream = new ReadableStream({
                //     async start(controller) {
                //         const encoder = new TextEncoder();
                //         try {
                //             while (true) {
                //                 const { done, value } = await reader.read();
                //                 if (done) {
                //                     break;
                //                 }
                //                 const content = new TextDecoder().decode(value);
                //                 console.log(content)
                //                 const completion = JSON.parse(content);
                //                 const chunk = completion.choices[0]?.delta?.content;
                //                 if (chunk) {
                //                     const text = encoder.encode(chunk);
                //                     controller.enqueue(text);
                //                 }
                //             }
                //         } catch (error) {
                //             console.error(error);
                //         } finally {
                //             controller.close();
                //         }
                //     }
                // });
                // return new Response(stream)
            }
            sendBtn.addEventListener("click", callLLM)
            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    callLLM()
                }
            })

            // API Key handling
            const apiKeyInput = chatContainer.querySelector("#openrouter-api-key")
            const saveKeyBtn = chatContainer.querySelector("#save-api-key")
            saveKeyBtn.addEventListener('click', () => {
                const newKey = apiKeyInput.value.trim()
                setOpenRouterApiKey(newKey)
                addAssistantMessage("API key has been saved.")
            })
            container.getElement().append(chatContainer)

        });

        layout.on("initialised", function () {
            setDefaults();
            refreshLayoutSize();
            window.top.postMessage({ event: "initialised" }, "*");
        });

        layout.init();
    });

    let superKey = "⌘";
    if (!/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)) {
        superKey = "Ctrl";
    }

    [$runBtn].forEach((btn) => {
        btn.attr("data-content", `${superKey}${btn.attr("data-content")}`);
    });

    document.querySelectorAll(".description").forEach((e) => {
        e.innerText = `${superKey}${e.innerText}`;
    });

    if (IS_PUTER) {
        puter.ui.onLaunchedWithItems(async function (items) {
            gPuterFile = items[0];
            openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
        });
    }

    document
        .getElementById("judge0-open-file-btn")
        .addEventListener("click", openAction);
    document
        .getElementById("judge0-save-btn")
        .addEventListener("click", saveAction);

    // document
    //     .getElementById("chat-button").addEventListener('click', sendButtonClicked);

    sourceEditor.addAction({
        id: "inline-help",
        label: "Inline Help",
        contextMenuGroupId: "navigation",
        contextMenuOrder: 1,
        run: function (editor) {
            console.log("Hi");
            const selection = editor.getSelection();

            if (!selection.isEmpty()) {
                const selectedText = sourceEditor.getModel().getValueInRange(selection);
                console.log("Highlighted text: ", selectedText);

                const selectionPosition = editor.getScrolledVisiblePosition(
                    selection.getStartPosition()
                );

                // Create popup
                const popup = document.createElement("div");
                popup.className = "ai-popup";
                popup.textContent = "This is a popup!";

                const chatMessages = document.createElement("div");
                chatMessages.className = "inline-res";

                const startingMessage = document.createElement("p");
                startingMessage.innerText = "Let's talk about what you selected.";
                chatMessages.appendChild(startingMessage);
                popup.appendChild(chatMessages);

                const chatField = document.createElement("textarea");
                chatField.id = "inline-chat-field";
                chatField.style.color = 'black'
                chatField.placeholder = "What should we implement.";
                popup.appendChild(chatField);
                // Handle enter key (but shift+enter for new line)
                $(popup).on("keydown", async function (e) {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        const input = document.getElementById("inline-chat-field");
                        console.log(input)
                        if (input.value) {
                            console.log("Input value: ", input.value);
                            const newMsg = document.createElement("p");
                            newMsg.innerText = input.value;
                            chatMessages.appendChild(newMsg);
                            document.getElementById('inline-chat-field').value = '';
                            const newLlmResponse = await llmInLineChat(
                                editor.getValue().trim(),
                                selectedText,
                                input.value
                            );
                            const llmMessage = document.createElement("p");
                            // llmMessage.innerHTML = marked.parse(newLlmResponse);
                            console.log(llmMessage)
                            llmMessage.innerHTML = marked.parse(newLlmResponse)
                            chatMessages.appendChild(llmMessage);
                        }
                    }
                });

                const inlineSubmitButton = document.createElement("button");
                inlineSubmitButton.id = "inline-chat-submit-button";
                inlineSubmitButton.innerText = "Submit";
                inlineSubmitButton.type = "submit"
                inlineSubmitButton.style.backgroundColor = 'Purple';
                inlineSubmitButton.style.color = 'white';
                inlineSubmitButton.addEventListener("click", async () => {
                    const input = document.getElementById("inline-chat-field");
                    if (input.value) {
                        console.log("Input value: ", input.value);
                        const newMsg = document.createElement("p");
                        newMsg.innerText = input.value;
                        chatMessages.appendChild(newMsg);
                        const newLlmResponse = await llmInLineChat(
                            editor.getValue().trim(),
                            selectedText,
                            input.value
                        );
                        const llmMessage = document.createElement("p");
                        llmMessage.innerText = newLlmResponse;
                        chatMessages.appendChild(llmMessage);
                    }
                });


                popup.appendChild(inlineSubmitButton);

                // Position popup above selection
                const editorDomNode = editor.getDomNode();
                const editorCoords = editorDomNode.getBoundingClientRect();
                popup.style.top = `${editorCoords.top + selectionPosition.top - 100}px`;
                popup.style.left = `${editorCoords.left + selectionPosition.left}px`;

                const closeBtn = document.createElement("button");

                closeBtn.className = "popup-close-btn";
                closeBtn.innerHTML = "×";
                closeBtn.onclick = () => popup.remove();

                popup.appendChild(closeBtn);
                document.body.appendChild(popup);
                $(document).on("keydown", "body", function (e) {
                    if (e.key === 'Escape' && popup) {
                        popup.remove()
                    }
                })

            } else {
                console.log("Nothing is highlighted.");
            }
        },
    });

    window.onmessage = function (e) {
        if (!e.data) {
            return;
        }

        if (e.data.action === "get") {
            window.top.postMessage(
                JSON.parse(
                    JSON.stringify({
                        event: "getResponse",
                        source_code: sourceEditor.getValue(),
                        language_id: getSelectedLanguageId(),
                        flavor: getSelectedLanguageFlavor(),
                        stdin: stdinEditor.getValue(),
                        stdout: stdoutEditor.getValue(),
                        compiler_options: $compilerOptions.val(),
                        command_line_arguments: $commandLineArguments.val(),
                    })
                ),
                "*"
            );
        } else if (e.data.action === "set") {
            if (e.data.source_code) {
                sourceEditor.setValue(e.data.source_code);
            }
            if (e.data.language_id && e.data.flavor) {
                selectLanguageByFlavorAndId(e.data.language_id, e.data.flavor);
            }
            if (e.data.stdin) {
                stdinEditor.setValue(e.data.stdin);
            }
            if (e.data.stdout) {
                stdoutEditor.setValue(e.data.stdout);
            }
            if (e.data.compiler_options) {
                $compilerOptions.val(e.data.compiler_options);
            }
            if (e.data.command_line_arguments) {
                $commandLineArguments.val(e.data.command_line_arguments);
            }
            if (e.data.api_key) {
                AUTH_HEADERS["Authorization"] = `Bearer ${e.data.api_key}`;
            }
        }
    };
});

const DEFAULT_SOURCE =
    "\
#include <algorithm>\n\
#include <cstdint>\n\
#include <iostream>\n\
#include <limits>\n\
#include <set>\n\
#include <utility>\n\
#include <vector>\n\
\n\
using Vertex    = std::uint16_t;\n\
using Cost      = std::uint16_t;\n\
using Edge      = std::pair< Vertex, Cost >;\n\
using Graph     = std::vector< std::vector< Edge > >;\n\
using CostTable = std::vector< std::uint64_t >;\n\
\n\
constexpr auto kInfiniteCost{ std::numeric_limits< CostTable::value_type >::max() };\n\
\n\
auto dijkstra( Vertex const start, Vertex const end, Graph const & graph, CostTable & costTable )\n\
{\n\
    std::fill( costTable.begin(), costTable.end(), kInfiniteCost );\n\
    costTable[ start ] = 0;\n\
\n\
    std::set< std::pair< CostTable::value_type, Vertex > > minHeap;\n\
    minHeap.emplace( 0, start );\n\
\n\
    while ( !minHeap.empty() )\n\
    {\n\
        auto const vertexCost{ minHeap.begin()->first  };\n\
        auto const vertex    { minHeap.begin()->second };\n\
\n\
        minHeap.erase( minHeap.begin() );\n\
\n\
        if ( vertex == end )\n\
        {\n\
            break;\n\
        }\n\
\n\
        for ( auto const & neighbourEdge : graph[ vertex ] )\n\
        {\n\
            auto const & neighbour{ neighbourEdge.first };\n\
            auto const & cost{ neighbourEdge.second };\n\
\n\
            if ( costTable[ neighbour ] > vertexCost + cost )\n\
            {\n\
                minHeap.erase( { costTable[ neighbour ], neighbour } );\n\
                costTable[ neighbour ] = vertexCost + cost;\n\
                minHeap.emplace( costTable[ neighbour ], neighbour );\n\
            }\n\
        }\n\
    }\n\
\n\
    return costTable[ end ];\n\
}\n\
\n\
int main()\n\
{\n\
    constexpr std::uint16_t maxVertices{ 10000 };\n\
\n\
    Graph     graph    ( maxVertices );\n\
    CostTable costTable( maxVertices );\n\
\n\
    std::uint16_t testCases;\n\
    std::cin >> testCases;\n\
\n\
    while ( testCases-- > 0 )\n\
    {\n\
        for ( auto i{ 0 }; i < maxVertices; ++i )\n\
        {\n\
            graph[ i ].clear();\n\
        }\n\
\n\
        std::uint16_t numberOfVertices;\n\
        std::uint16_t numberOfEdges;\n\
\n\
        std::cin >> numberOfVertices >> numberOfEdges;\n\
\n\
        for ( auto i{ 0 }; i < numberOfEdges; ++i )\n\
        {\n\
            Vertex from;\n\
            Vertex to;\n\
            Cost   cost;\n\
\n\
            std::cin >> from >> to >> cost;\n\
            graph[ from ].emplace_back( to, cost );\n\
        }\n\
\n\
        Vertex start;\n\
        Vertex end;\n\
\n\
        std::cin >> start >> end;\n\
\n\
        auto const result{ dijkstra( start, end, graph, costTable ) };\n\
\n\
        if ( result == kInfiniteCost )\n\
        {\n\
            std::cout << \"NO\\n\";\n\
        }\n\
        else\n\
        {\n\
            std::cout << result << '\\n';\n\
        }\n\
    }\n\
\n\
    return 0;\n\
}\n\
";

const DEFAULT_STDIN =
    "\
3\n\
3 2\n\
1 2 5\n\
2 3 7\n\
1 3\n\
3 3\n\
1 2 4\n\
1 3 7\n\
2 3 1\n\
1 3\n\
3 1\n\
1 2 4\n\
1 3\n\
";

const DEFAULT_COMPILER_OPTIONS = "";
const DEFAULT_CMD_ARGUMENTS = "";
const DEFAULT_LANGUAGE_ID = 105; // C++ (GCC 14.1.0) (https://ce.judge0.com/languages/105)

function getEditorLanguageMode(languageName) {
    const DEFAULT_EDITOR_LANGUAGE_MODE = "plaintext";
    const LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE = {
        Bash: "shell",
        C: "c",
        C3: "c",
        "C#": "csharp",
        "C++": "cpp",
        Clojure: "clojure",
        "F#": "fsharp",
        Go: "go",
        Java: "java",
        JavaScript: "javascript",
        Kotlin: "kotlin",
        "Objective-C": "objective-c",
        Pascal: "pascal",
        Perl: "perl",
        PHP: "php",
        Python: "python",
        R: "r",
        Ruby: "ruby",
        SQL: "sql",
        Swift: "swift",
        TypeScript: "typescript",
        "Visual Basic": "vb",
    };

    for (let key in LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE) {
        if (languageName.toLowerCase().startsWith(key.toLowerCase())) {
            return LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE[key];
        }
    }
    return DEFAULT_EDITOR_LANGUAGE_MODE;
}

const EXTENSIONS_TABLE = {
    asm: { flavor: CE, language_id: 45 }, // Assembly (NASM 2.14.02)
    c: { flavor: CE, language_id: 103 }, // C (GCC 14.1.0)
    cpp: { flavor: CE, language_id: 105 }, // C++ (GCC 14.1.0)
    cs: { flavor: EXTRA_CE, language_id: 29 }, // C# (.NET Core SDK 7.0.400)
    go: { flavor: CE, language_id: 95 }, // Go (1.18.5)
    java: { flavor: CE, language_id: 91 }, // Java (JDK 17.0.6)
    js: { flavor: CE, language_id: 102 }, // JavaScript (Node.js 22.08.0)
    lua: { flavor: CE, language_id: 64 }, // Lua (5.3.5)
    pas: { flavor: CE, language_id: 67 }, // Pascal (FPC 3.0.4)
    php: { flavor: CE, language_id: 98 }, // PHP (8.3.11)
    py: { flavor: EXTRA_CE, language_id: 25 }, // Python for ML (3.11.2)
    r: { flavor: CE, language_id: 99 }, // R (4.4.1)
    rb: { flavor: CE, language_id: 72 }, // Ruby (2.7.0)
    rs: { flavor: CE, language_id: 73 }, // Rust (1.40.0)
    scala: { flavor: CE, language_id: 81 }, // Scala (2.13.2)
    sh: { flavor: CE, language_id: 46 }, // Bash (5.0.0)
    swift: { flavor: CE, language_id: 83 }, // Swift (5.2.3)
    ts: { flavor: CE, language_id: 101 }, // TypeScript (5.6.2)
    txt: { flavor: CE, language_id: 43 }, // Plain Text
};

function getLanguageForExtension(extension) {
    return EXTENSIONS_TABLE[extension] || { flavor: CE, language_id: 43 }; // Plain Text (https://ce.judge0.com/languages/43)
}