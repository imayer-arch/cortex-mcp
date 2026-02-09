/**
 * Embeddings opcionales para búsqueda semántica. Si @xenova/transformers está instalado
 * (optionalDependency), se usan; si no, CORTEX sigue con búsqueda por términos.
 */
import type { MemoryEntry } from "./memory/types.js";

const EMBEDDING_DIM = 384;
const TEXT_MAX_LEN = 2000;

let embedder: ((text: string) => Promise<number[]>) | null = null;
let embedderPromise: Promise<((text: string) => Promise<number[]>) | null> | null = null;

export function isEmbeddingAvailable(): boolean {
  return embedder !== null;
}

/** Obtiene el embedder (carga @xenova/transformers bajo demanda). Solo se intenta una vez. */
export async function getEmbedder(): Promise<((text: string) => Promise<number[]>) | null> {
  if (embedder) return embedder;
  if (embedderPromise) return embedderPromise;
  embedderPromise = (async () => {
    try {
      const { pipeline } = await import("@xenova/transformers");
      const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        quantized: true,
        progress_callback: () => {},
      });
      embedder = async (text: string): Promise<number[]> => {
        const t = text.slice(0, TEXT_MAX_LEN).trim() || " ";
        const out = await extractor(t, { pooling: "mean", normalize: true });
        const arr = Array.from(out.data as Float32Array);
        return arr.length === EMBEDDING_DIM ? arr : [];
      };
      return embedder;
    } catch {
      return null;
    }
  })();
  return embedderPromise;
}

/** Rellena entry.embedding para entradas que tengan título o contenido. Respetamos CORTEX_EMBED=1 para activar. */
export async function computeEmbeddingsForEntries(entries: MemoryEntry[]): Promise<void> {
  if (process.env.CORTEX_EMBED !== "1" && process.env.CORTEX_EMBED !== "true") return;
  const embed = await getEmbedder();
  if (!embed) return;
  const toProcess = entries.filter((e) => !e.embedding && (e.title || e.content));
  const BATCH = 8;
  for (let i = 0; i < toProcess.length; i += BATCH) {
    const batch = toProcess.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (entry) => {
        const text = `${entry.title}\n${entry.content}`.slice(0, TEXT_MAX_LEN);
        try {
          entry.embedding = await embed(text);
        } catch {
          // skip
        }
      })
    );
  }
}

