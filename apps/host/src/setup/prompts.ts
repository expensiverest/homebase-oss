import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export class SetupCancelled extends Error {
  constructor() {
    super("Setup cancelled. Completed configuration was preserved.");
  }
}
export interface SetupPrompter {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  input(message: string, defaultValue?: string): Promise<string>;
  choose(message: string, choices: string[]): Promise<string>;
}
export class ReadlinePrompter implements SetupPrompter {
  readonly #readline = createInterface({ input: stdin, output: stdout });
  readonly #abort = new AbortController();
  readonly #cancel = () => {
    this.#abort.abort();
    this.#readline.close();
  };
  constructor() {
    if (!stdin.isTTY) {
      this.close();
      throw new Error("Setup needs an interactive terminal. Run `homebase setup` in your terminal.");
    }
    this.#readline.on("SIGINT", this.#cancel);
    process.on("SIGINT", this.#cancel);
  }
  async input(message: string, defaultValue = ""): Promise<string> {
    if (this.#abort.signal.aborted) throw new SetupCancelled();
    try {
      const answer = await this.#readline.question(`${message}${defaultValue ? ` [${defaultValue}]` : ""}: `, {
        signal: this.#abort.signal,
      });
      return answer.trim() || defaultValue;
    } catch {
      throw new SetupCancelled();
    }
  }
  async confirm(message: string, defaultValue = true): Promise<boolean> {
    const answer = await this.input(`${message} ${defaultValue ? "[Y/n]" : "[y/N]"}`, defaultValue ? "y" : "n");
    if (/^(y|yes)$/i.test(answer)) return true;
    if (/^(n|no)$/i.test(answer)) return false;
    return this.confirm(message, defaultValue);
  }
  async choose(message: string, choices: string[]): Promise<string> {
    const answer = await this.input(`${message} (${choices.join(" / ")})`, choices[0]);
    return choices.includes(answer) ? answer : this.choose(message, choices);
  }
  close(): void {
    process.removeListener("SIGINT", this.#cancel);
    this.#readline.close();
  }
}
