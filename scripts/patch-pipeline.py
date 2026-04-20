import sys

with open('/tmp/ba-work/app/pipeline/page.tsx', 'r', encoding='utf-8') as f:
    src = f.read()

results = []

# 1. 배치 상태 변수 추가
old1 = '  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);\n  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);'
new1 = (
    '  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);\n'
    '  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);\n'
    '  // \u2500\u2500 \ubc30\uce58 \uc790\ub3d9 \uc2e4\ud589 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n'
    '  const [batchRunning, setBatchRunning] = useState(false);\n'
    '  const [batchQueue, setBatchQueue] = useState<Topic[]>([]);\n'
    '  const [batchIndex, setBatchIndex] = useState(0);\n'
    '  const [batchResults, setBatchResults] = useState<{ topicId: string; title: string; status: string; score?: number }[]>([]);\n'
    '  const batchRunningRef = useRef(false);\n'
    '  const batchQueueRef = useRef<Topic[]>([]);\n'
    '  const batchIndexRef = useRef(0);\n'
    '  const batchNextRef = useRef<(() => void) | null>(null);\n'
    '  const startPipelineRef = useRef<(() => Promise<void>) | null>(null);'
)
if old1 in src:
    src = src.replace(old1, new1, 1)
    results.append('OK: \ubc30\uce58 \uc0c1\ud0dc')
else:
    results.append('MISS: \ubc30\uce58 \uc0c1\ud0dc')

# 2. result 이벤트 체인
old2 = (
    '      setRunning(false);\n'
    '      setRunningTitle(null);\n'
    '      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }\n'
    '    }\n'
    '    if (event.type === "gate_blocked")'
)
new2 = (
    '      setRunning(false);\n'
    '      setRunningTitle(null);\n'
    '      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }\n'
    '      if (batchRunningRef.current && batchNextRef.current) {\n'
    '        const fn = batchNextRef.current; batchNextRef.current = null;\n'
    '        const rd = event.data as ResultData;\n'
    '        setBatchResults(prev => [...prev, { topicId: rd.postId ?? "", title: rd.title ?? "", status: rd.pass ? "OK" : "LOW", score: rd.evalScore }]);\n'
    '        setTimeout(fn, 3000);\n'
    '      }\n'
    '    }\n'
    '    if (event.type === "gate_blocked")'
)
if old2 in src:
    src = src.replace(old2, new2, 1)
    results.append('OK: result \uccb4\uc778')
else:
    results.append('MISS: result \uccb4\uc778')

# 3. gate_blocked 체인
old3 = (
    '      setRunning(false);\n'
    '      setRunningTitle(null);\n'
    '      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }\n'
    '    }\n'
    '    if (event.type === "error")'
)
new3 = (
    '      setRunning(false);\n'
    '      setRunningTitle(null);\n'
    '      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }\n'
    '      if (batchRunningRef.current && batchNextRef.current) {\n'
    '        const fn = batchNextRef.current; batchNextRef.current = null;\n'
    '        setBatchResults(prev => [...prev, { topicId: "", title: String((event.data as Record<string,unknown>).draft ?? ""), status: "GATE" }]);\n'
    '        setTimeout(fn, 3000);\n'
    '      }\n'
    '    }\n'
    '    if (event.type === "error")'
)
if old3 in src:
    src = src.replace(old3, new3, 1)
    results.append('OK: gate_blocked \uccb4\uc778')
else:
    results.append('MISS: gate_blocked \uccb4\uc778')

# 4. error 체인
old4 = (
    '      setRunning(false);\n'
    '      setRunningTitle(null);\n'
    '      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }\n'
    '    }\n'
    '  }, [appendEvent, setInspector, setStage, appendStreamingToken, setResult, setRunningTitle]);'
)
new4 = (
    '      setRunning(false);\n'
    '      setRunningTitle(null);\n'
    '      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }\n'
    '      if (batchRunningRef.current && batchNextRef.current) {\n'
    '        const fn = batchNextRef.current; batchNextRef.current = null;\n'
    '        setBatchResults(prev => [...prev, { topicId: "", title: msg, status: "ERR" }]);\n'
    '        setTimeout(fn, 3000);\n'
    '      }\n'
    '    }\n'
    '  }, [appendEvent, setInspector, setStage, appendStreamingToken, setResult, setRunningTitle]);'
)
if old4 in src:
    src = src.replace(old4, new4, 1)
    results.append('OK: error \uccb4\uc778')
else:
    results.append('MISS: error \uccb4\uc778')

# 5. startBatch + startPipelineRef 동기화
old5 = '  const canStart = (() => {'
new5 = (
    '  useEffect(() => { startPipelineRef.current = startPipeline; });\n\n'
    '  const startBatch = useCallback(() => {\n'
    '    if (running || batchRunning) return;\n'
    '    const queue = availableTopics.slice();\n'
    '    if (queue.length === 0) return;\n'
    '    setBatchRunning(true);\n'
    '    batchRunningRef.current = true;\n'
    '    setBatchQueue(queue);\n'
    '    batchQueueRef.current = queue;\n'
    '    setBatchIndex(0);\n'
    '    batchIndexRef.current = 0;\n'
    '    setBatchResults([]);\n'
    '    setAutoApprove(true);\n'
    '    const runAt = (idx: number) => {\n'
    '      if (!batchRunningRef.current || idx >= batchQueueRef.current.length) {\n'
    '        setBatchRunning(false);\n'
    '        batchRunningRef.current = false;\n'
    '        reloadTopics();\n'
    '        return;\n'
    '      }\n'
    '      const topic = batchQueueRef.current[idx];\n'
    '      batchIndexRef.current = idx;\n'
    '      setBatchIndex(idx);\n'
    '      batchNextRef.current = () => runAt(idx + 1);\n'
    '      resetRun();\n'
    '      setEvents([]);\n'
    '      setStreamingBody("");\n'
    '      setResult(null);\n'
    '      setStage("idle");\n'
    '      setPipelineError(null);\n'
    '      setTopicMode("list");\n'
    '      setSelectedTopicId(topic.topicId);\n'
    '      setTimeout(() => { startPipelineRef.current?.(); }, 400);\n'
    '    };\n'
    '    runAt(0);\n'
    '  // eslint-disable-next-line react-hooks/exhaustive-deps\n'
    '  }, [running, batchRunning, availableTopics, setAutoApprove, resetRun, setEvents, setStreamingBody, setResult, setStage, setTopicMode, setSelectedTopicId]);\n\n'
    '  const canStart = (() => {'
)
if old5 in src:
    src = src.replace(old5, new5, 1)
    results.append('OK: startBatch')
else:
    results.append('MISS: startBatch')

# 6. 배치 버튼 UI
old6 = (
    '        <button\n'
    '          onClick={startPipeline}\n'
    '          disabled={!canStart}\n'
    '          className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"\n'
    '        >\n'
    '          {running ? "\uae00\uc4f0\uae30 \uc9c4\ud589 \uc911..." : "\uae00\uc4f0\uae30 \uc2dc\uc791"}\n'
    '        </button>\n\n'
    '      </div>'
)
new6 = (
    '        <button\n'
    '          onClick={startPipeline}\n'
    '          disabled={!canStart || batchRunning}\n'
    '          className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"\n'
    '        >\n'
    '          {running ? "\uae00\uc4f0\uae30 \uc9c4\ud589 \uc911..." : "\uae00\uc4f0\uae30 \uc2dc\uc791"}\n'
    '        </button>\n\n'
    '        {!batchRunning ? (\n'
    '          <button\n'
    '            onClick={startBatch}\n'
    '            disabled={running || availableTopics.length === 0}\n'
    '            className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"\n'
    '          >\n'
    '            \u25b6\u25b6 \uc804\uccb4 \uc790\ub3d9 \uc2e4\ud589 ({availableTopics.length}\uac1c \u00b7 \uc790\ub3d9\uc2b9\uc778)\n'
    '          </button>\n'
    '        ) : (\n'
    '          <div className="space-y-2">\n'
    '            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">\n'
    '              <span className="text-sm font-semibold text-emerald-700">\n'
    '                \ubc30\uce58 \uc2e4\ud589 \uc911 {batchIndex + 1} / {batchQueue.length}\n'
    '              </span>\n'
    '              <button\n'
    '                onClick={() => { setBatchRunning(false); batchRunningRef.current = false; batchNextRef.current = null; }}\n'
    '                className="text-xs text-red-500 hover:text-red-700 font-medium"\n'
    '              >\n'
    '                \uc911\ub2e8\n'
    '              </button>\n'
    '            </div>\n'
    '            {batchResults.length > 0 && (\n'
    '              <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 max-h-40 overflow-y-auto space-y-0.5">\n'
    '                {batchResults.map((r, i) => (\n'
    '                  <div key={i} className="flex justify-between text-xs text-zinc-600">\n'
    '                    <span className="truncate flex-1">[{r.status}] {r.title.slice(0, 30)}</span>\n'
    '                    {r.score != null && <span className="ml-2 font-mono">{r.score}\uc810</span>}\n'
    '                  </div>\n'
    '                ))}\n'
    '              </div>\n'
    '            )}\n'
    '          </div>\n'
    '        )}\n\n'
    '      </div>'
)
if old6 in src:
    src = src.replace(old6, new6, 1)
    results.append('OK: \ubc30\uce58 UI')
else:
    results.append('MISS: \ubc30\uce58 UI')

with open('/tmp/ba-work/app/pipeline/page.tsx', 'w', encoding='utf-8') as f:
    f.write(src)

for r in results:
    print(r)
print('완료')
