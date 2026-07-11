interface DeferredCommand {
  key: string;
  execute: () => void;
}

export class DeferredCommandQueue {
  private readonly commands = new Map<string, DeferredCommand>();

  get size(): number {
    return this.commands.size;
  }

  defer(key: string, execute: () => void): boolean {
    if (!key) throw new Error('Deferred commands require a stable key.');
    if (this.commands.has(key)) return false;
    this.commands.set(key, {key, execute});
    return true;
  }

  cancel(key: string): boolean {
    return this.commands.delete(key);
  }

  clear(): void {
    this.commands.clear();
  }

  flush(maxCommands = 4096): number {
    if (!Number.isInteger(maxCommands) || maxCommands <= 0) {
      throw new RangeError('maxCommands must be a positive integer.');
    }
    if (this.commands.size > maxCommands) {
      throw new Error(`Deferred command budget exceeded: ${this.commands.size}/${maxCommands}.`);
    }

    const batch = [...this.commands.values()];
    this.commands.clear();
    for (const command of batch) command.execute();
    return batch.length;
  }
}
