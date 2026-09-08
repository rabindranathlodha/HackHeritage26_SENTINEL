// WordPiece tokenisation, in the browser.
//
// The model expects token ids produced by exactly the tokenizer it was trained
// with. Getting this subtly wrong does not throw — it produces confident,
// meaningless scores, which is precisely how the backend's own tokenizer bug
// went unnoticed until 97% of every input had become [UNK]. So this is a direct
// implementation of the three things the exported tokenizer.json declares, and
// nothing else, with a parity test against the Python tokenizer's output.
//
// From tokenizer.json:
//   normalizer:      null            (the model is cased; nothing is stripped)
//   pre_tokenizer:   Whitespace      (HF's regex, not a split on " ")
//   model:           WordPiece, "##" continuation, [UNK], 100 chars max/word
//   post_processor:  [CLS] A [SEP]
//
// A library would be the obvious alternative, but every JS tokenizer package
// pulls in a multi-megabyte runtime for a phone that is already being asked to
// download a model.

export type TokenizerConfig = {
  model: {
    vocab: Record<string, number>;
    unk_token: string;
    continuing_subword_prefix: string;
    max_input_chars_per_word: number;
  };
  added_tokens: { content: string; id: number }[];
};

export type Encoding = {
  inputIds: number[];
  attentionMask: number[];
};

// HF's `Whitespace` pre-tokenizer is the regex \w+|[^\w\s]+, not a split on
// spaces. In Rust's regex crate \w with Unicode means alphabetic, marks,
// decimal digits and connector punctuation — spelled out here because JS's \w
// is ASCII-only and would break every Devanagari word into [UNK].
const WORD = String.raw`[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}]+`;
const NON_WORD = String.raw`[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\s]+`;
const PRE_TOKENIZE = new RegExp(`${WORD}|${NON_WORD}`, "gu");

export class WordPieceTokenizer {
  readonly #vocab: Map<string, number>;
  readonly #unkId: number;
  readonly #prefix: string;
  readonly #maxChars: number;
  readonly #clsId: number;
  readonly #sepId: number;
  readonly padId: number;

  constructor(config: TokenizerConfig) {
    this.#vocab = new Map(Object.entries(config.model.vocab));
    this.#prefix = config.model.continuing_subword_prefix;
    this.#maxChars = config.model.max_input_chars_per_word;

    const id = (token: string): number => {
      const found = this.#vocab.get(token);
      if (found === undefined) throw new Error(`tokenizer is missing ${token}`);
      return found;
    };
    this.#unkId = id(config.model.unk_token);
    this.#clsId = id("[CLS]");
    this.#sepId = id("[SEP]");
    this.padId = id("[PAD]");
  }

  static fromJSON(raw: unknown): WordPieceTokenizer {
    return new WordPieceTokenizer(raw as TokenizerConfig);
  }

  /** Greedy longest-match-first over a single pre-token. */
  #wordPiece(word: string): number[] {
    if ([...word].length > this.#maxChars) return [this.#unkId];

    const pieces: number[] = [];
    let start = 0;
    while (start < word.length) {
      let end = word.length;
      let matched: number | undefined;

      while (start < end) {
        const candidate =
          start === 0 ? word.slice(start, end) : this.#prefix + word.slice(start, end);
        const id = this.#vocab.get(candidate);
        if (id !== undefined) {
          matched = id;
          break;
        }
        end -= 1;
      }

      // One unmatched piece makes the WHOLE word [UNK], which is WordPiece's
      // actual behaviour — not "keep the pieces that did match".
      if (matched === undefined) return [this.#unkId];
      pieces.push(matched);
      start = end;
    }
    return pieces;
  }

  /**
   * Encodes to the model's inputs, padded to `maxLength`.
   *
   * Truncation leaves room for [CLS] and [SEP], matching the Python tokenizer's
   * `truncation=True, max_length=n`.
   */
  encode(text: string, maxLength = 160): Encoding {
    const ids: number[] = [];
    for (const match of text.matchAll(PRE_TOKENIZE)) {
      ids.push(...this.#wordPiece(match[0]));
    }

    const room = maxLength - 2;
    const body = ids.length > room ? ids.slice(0, room) : ids;
    const withSpecials = [this.#clsId, ...body, this.#sepId];

    const attentionMask = withSpecials.map(() => 1);
    while (withSpecials.length < maxLength) {
      withSpecials.push(this.padId);
      attentionMask.push(0);
    }

    return { inputIds: withSpecials, attentionMask };
  }

  /** Without padding, for comparing against the Python tokenizer. */
  encodeUnpadded(text: string, maxLength = 160): number[] {
    const { inputIds, attentionMask } = this.encode(text, maxLength);
    return inputIds.filter((_, i) => attentionMask[i] === 1);
  }
}
