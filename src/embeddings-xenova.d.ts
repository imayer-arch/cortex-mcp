/**
 * Declaración para la dependencia opcional @xenova/transformers.
 * Si no está instalada, el dynamic import falla en runtime y CORTEX usa búsqueda por términos.
 */
declare module "@xenova/transformers" {
  export function pipeline(
    task: string,
    model: string,
    options?: { quantized?: boolean; progress_callback?: () => void }
  ): Promise<{
    (input: string, options?: { pooling?: string; normalize?: boolean }): Promise<{ data: Float32Array }>;
  }>;
}
