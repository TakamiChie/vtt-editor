import React, { useState, useMemo, useRef, useEffect } from "react";
import { shouldBlockPageLeave } from "./beforeUnload";

// VTTの各セグメント（Cue）の型定義
interface VttCue {
  id: string;
  startTime: string;
  endTime: string;
  text: string;
}

const VttEditor: React.FC = () => {
  const [cues, setCues] = useState<VttCue[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [searchMatchIndex, setSearchMatchIndex] = useState(-1);
  const [charThreshold, setCharThreshold] = useState<number>(() => {
    const saved = localStorage.getItem("vtt-char-threshold");
    return saved ? Number(saved) : 20;
  });
  const [fileExtension, setFileExtension] = useState<string>(() => {
    const saved = localStorage.getItem("vtt-file-extension");
    return saved || "txt";
  });
  const scrollRef = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Thresholdが変更されたらローカルストレージに保存
  useEffect(() => {
    localStorage.setItem("vtt-char-threshold", charThreshold.toString());
  }, [charThreshold]);

  // 検索条件が変わったらマッチ位置をリセット
  useEffect(() => {
    setSearchMatchIndex(-1);
  }, [searchTerm, isRegex]);

  // 拡張子設定が変更されたらローカルストレージに保存
  useEffect(() => {
    localStorage.setItem("vtt-file-extension", fileExtension);
  }, [fileExtension]);

  // 読み込み済みデータがある状態でページ遷移する際に警告を表示
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlockPageLeave(cues.length)) return;
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [cues.length]);

  // --- ファイル処理 ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => parseVtt(ev.target?.result as string);
      reader.readAsText(file);
    }
  };

  const parseVtt = (content: string) => {
    const lines = content.split("\n");
    const parsedCues: VttCue[] = [];
    let currentCue: Partial<VttCue> = {};

    lines.forEach((line, index) => {
      if (line.includes("-->")) {
        const [start, end] = line.split(" --> ");
        currentCue.startTime = start.trim();
        currentCue.endTime = end.trim();
        currentCue.id = `cue-${index}`;
      } else if (line.trim() !== "" && !line.startsWith("WEBVTT")) {
        currentCue.text =
          (currentCue.text ? currentCue.text + "\n" : "") + line;
        if (lines[index + 1]?.trim() === "" || index === lines.length - 1) {
          parsedCues.push(currentCue as VttCue);
          currentCue = {};
        }
      }
    });
    setCues(parsedCues);
  };

  // --- 要件1: 行のマージ ---
  const mergeNext = (index: number) => {
    if (index >= cues.length - 1) return;
    const nextCue = cues[index + 1];
    const updatedCues = [...cues];

    // 次の行の話者表記（<v 話者名>）を削除
    const nextTextWithoutSpeaker = nextCue.text
      .replace(/<v [^>]+>/g, "")
      .trim();

    updatedCues[index] = {
      ...updatedCues[index],
      endTime: nextCue.endTime, // 次の行の終了時刻に合わせる
      text: `${updatedCues[index].text} ${nextTextWithoutSpeaker}`.replace(
        /\n/g,
        " ",
      ), // テキストを結合
    };

    updatedCues.splice(index + 1, 1); // 次の行を削除
    setCues(updatedCues);
  };

  // --- 要件2: タイムスタンプジャンプ ---
  const jumpToCue = (index: number) => {
    setCurrentIndex(index);
    scrollRef.current[cues[index].id]?.scrollIntoView({ behavior: "smooth" });
  };

  // --- 要件3: 指定文字数を下回る行までジャンプ ---
  const jumpToShortLine = () => {
    const startIdx = (currentIndex ?? -1) + 1;
    const nextShortIdx = cues.findIndex(
      (cue, idx) => idx >= startIdx && cue.text.length < charThreshold,
    );
    if (nextShortIdx !== -1) jumpToCue(nextShortIdx);
  };

  // --- 要件4: 文字列検索 (Regex対応) ---
  const filteredIndices = useMemo(() => {
    if (!searchTerm) return [];
    try {
      const regex = isRegex ? new RegExp(searchTerm, "i") : null;
      return cues
        .map((cue, idx) => {
          const match = isRegex
            ? regex?.test(cue.text)
            : cue.text.includes(searchTerm);
          return match ? idx : -1;
        })
        .filter((idx) => idx !== -1);
    } catch (e) {
      return [];
    }
  }, [searchTerm, cues, isRegex]);

  // --- 検索結果へのジャンプ ---
  const jumpToNextMatch = () => {
    if (filteredIndices.length === 0) return;
    const nextMatchIdx = (searchMatchIndex + 1) % filteredIndices.length;
    setSearchMatchIndex(nextMatchIdx);
    jumpToCue(filteredIndices[nextMatchIdx]);
  };

  // --- エクスポート処理 ---
  const downloadFile = (content: string, fileName: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAll = () => {
    const content =
      "WEBVTT\n\n" +
      cues
        .map((c) => `${c.startTime} --> ${c.endTime}\n${c.text}`)
        .join("\n\n");
    downloadFile(content, `output_all.${fileExtension}`);
  };

  const exportBySpeaker = (speaker: string) => {
    const speakerCues = cues.filter((cue) =>
      cue.text.includes(`<v ${speaker}>`),
    );
    const content =
      "WEBVTT\n\n" +
      speakerCues
        .map((c) => `${c.startTime} --> ${c.endTime}\n${c.text}`)
        .join("\n\n");
    downloadFile(content, `${speaker}.${fileExtension}`);
  };

  const exportAllSpeakers = () => {
    uniqueSpeakers.forEach((speaker) => exportBySpeaker(speaker));
  };

  // --- 話者名の一覧を取得 ---
  const uniqueSpeakers = useMemo(() => {
    const speakers = new Set<string>();
    cues.forEach((cue) => {
      const match = cue.text.match(/<v ([^>]+)>/);
      if (match) speakers.add(match[1]);
    });
    return Array.from(speakers).sort();
  }, [cues]);

  // --- プレビュー用テキストの抽出 ---
  const getCuePreview = (text: string) => {
    // 話者名の抽出 (<v 話者名>)
    const speakerMatch = text.match(/<v ([^>]+)>/);
    const speaker = speakerMatch ? speakerMatch[1] : "";

    // タグを除去した純粋なテキスト
    const plainText = text.replace(/<v [^>]+>/g, "").trim();

    // 最初の句読点の位置を探す (。 、 . , ! ? など)
    const punctuationRegex =
      /[\u3001\u3002,.!?！\uff1f\u3001\uff0c\u3002\uff0e]/;
    const punctIndex = plainText.search(punctuationRegex);

    // 8文字目か句読点の早い方までを取得
    const previewLength = punctIndex !== -1 && punctIndex < 8 ? punctIndex : 8;
    const preview = plainText.substring(0, previewLength);

    return { speaker, preview, plainText, previewLength };
  };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
      {/* 左サイドバー: タイムスタンプ一覧 */}
      <div
        style={{
          width: "300px",
          borderRight: "1px solid #ccc",
          overflowY: "auto",
          padding: "10px",
        }}
      >
        <h3>Speakers</h3>
        <div
          style={{
            marginBottom: "20px",
            display: "flex",
            flexWrap: "wrap",
            gap: "5px",
          }}
        >
          {uniqueSpeakers.length > 0 ? (
            uniqueSpeakers.map((speaker) => (
              <span
                key={speaker}
                style={{
                  padding: "2px 8px",
                  backgroundColor: "#e7f3ff",
                  color: "#007bff",
                  borderRadius: "12px",
                  fontSize: "0.75em",
                  fontWeight: "bold",
                  border: "1px solid #cce5ff",
                }}
              >
                {speaker}
              </span>
            ))
          ) : (
            <span style={{ fontSize: "0.8em", color: "#999" }}>
              No speakers found
            </span>
          )}
        </div>

        <h3>Cues</h3>
        {cues.map((cue, idx) => {
          const { speaker, preview, plainText, previewLength } = getCuePreview(
            cue.text,
          );

          // 背景色の決定ロジック
          let bgColor = "transparent";
          if (currentIndex === idx) {
            bgColor = "#e0f0ff"; // 選択中 (青)
          } else if (plainText.length < charThreshold) {
            bgColor = "#fff9c4"; // 文字数不足 (黄)
          } else if (/[、，,]$/.test(plainText)) {
            bgColor = "#ffe0b2"; // 句読点で終了 (オレンジ)
          }

          return (
            <div
              key={cue.id}
              onClick={() => jumpToCue(idx)}
              style={{
                cursor: "pointer",
                padding: "8px 4px",
                fontSize: "0.85em",
                borderBottom: "1px solid #eee",
                backgroundColor: bgColor,
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: "2px" }}>
                {cue.startTime}
              </div>
              <div
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {speaker && (
                  <span style={{ color: "#007bff", fontWeight: "bold" }}>
                    [{speaker}]
                  </span>
                )}
                <span
                  style={{ marginLeft: speaker ? "5px" : "0", color: "#555" }}
                >
                  {preview}
                  {plainText.length > previewLength ? "..." : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* メインエディタ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "10px",
            borderBottom: "1px solid #ccc",
            background: "#f9f9f9",
          }}
        >
          <input type="file" onChange={handleFileUpload} accept=".vtt,.txt" />
          <div style={{ marginTop: "10px" }}>
            <input
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button
              onClick={jumpToNextMatch}
              disabled={!searchTerm || filteredIndices.length === 0}
              style={{ marginLeft: "5px" }}
            >
              検索 / 次へ
            </button>
            <span
              style={{
                marginLeft: "5px",
                fontSize: "0.8em",
                color: "#666",
                minWidth: "40px",
                display: "inline-block",
              }}
            >
              {filteredIndices.length > 0
                ? `${searchMatchIndex + 1} / ${filteredIndices.length}`
                : ""}
            </span>
            <label style={{ marginLeft: "10px" }}>
              <input
                type="checkbox"
                checked={isRegex}
                onChange={() => setIsRegex(!isRegex)}
              />{" "}
              Regex
            </label>
            <span style={{ marginLeft: "15px" }}>
              Threshold:{" "}
              <input
                type="number"
                value={charThreshold}
                onChange={(e) => setCharThreshold(Number(e.target.value))}
                style={{ width: "50px" }}
              />
              <button onClick={jumpToShortLine}>Find Short Line</button>
            </span>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {cues.map((cue, idx) => {
            const { plainText } = getCuePreview(cue.text);

            // 背景色の決定ロジック
            let bgColor = "white";
            if (currentIndex === idx) {
              bgColor = "#f0f7ff"; // 選択中の背景を少し明るく
            } else if (plainText.length < charThreshold) {
              bgColor = "#fff9c4"; // 文字数不足
            } else if (/[、，,]$/.test(plainText)) {
              bgColor = "#ffe0b2"; // 句読点終了
            }

            return (
              <div
                key={cue.id}
                ref={(el) => {
                  scrollRef.current[cue.id] = el;
                }}
                style={{
                  marginBottom: "15px",
                  padding: "10px",
                  backgroundColor: bgColor,
                  border:
                    currentIndex === idx
                      ? "2px solid #007bff"
                      : "1px solid #eee",
                }}
              >
                <div style={{ color: "#666", fontSize: "0.8em" }}>
                  {cue.startTime} --&gt; {cue.endTime}
                  (文字数: {plainText.length})
                </div>
                <textarea
                  style={{ width: "100%", marginTop: "5px" }}
                  value={cue.text}
                  onClick={() => setCurrentIndex(idx)} // テキストエリアクリック時にcurrentIndexを更新
                  onChange={(e) => {
                    const newCues = [...cues];
                    newCues[idx].text = e.target.value;
                    setCues(newCues);
                  }}
                />
                <button onClick={() => mergeNext(idx)}>Merge with Next</button>
              </div>
            );
          })}
        </div>

        <div
          style={{
            padding: "15px",
            borderTop: "1px solid #ccc",
            display: "flex",
            alignItems: "center",
            gap: "15px",
            background: "#f9f9f9",
          }}
        >
          <label style={{ fontSize: "0.9em", fontWeight: "bold" }}>
            保存拡張子:
            <select
              value={fileExtension}
              onChange={(e) => setFileExtension(e.target.value)}
              style={{ marginLeft: "5px" }}
            >
              <option value="txt">.txt</option>
              <option value="vtt">.vtt</option>
            </select>
          </label>
          <button onClick={exportAll} disabled={cues.length === 0}>
            全内容を保存
          </button>
          <button
            onClick={exportAllSpeakers}
            disabled={uniqueSpeakers.length === 0}
          >
            話者別に保存 ({uniqueSpeakers.length}ファイル)
          </button>
        </div>
      </div>
    </div>
  );
};

export default VttEditor;
