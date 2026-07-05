// LLM プロバイダ抽象化：問い返しの中身に依存しない最小 I/F。
// これを実装すれば Gemini / Claude / ローカル等を差し替えられる。

export interface StructuredRequest {
  /** システム指示（AIの役割・制約。例：問い返す先輩スクラムマスター） */
  system?: string;
  /** ユーザープロンプト本文（付箋・前回アクション・ナレッジ等をまとめたもの） */
  prompt: string;
}

export interface LlmProvider {
  /** プロバイダ名（gemini / claude 等） */
  readonly name: string;
  /** 使用モデル名 */
  readonly model: string;
  /** JSON テキストを生成して返す（呼び出し側で parse / 検証する） */
  generateJson(req: StructuredRequest): Promise<string>;
}
