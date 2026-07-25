export interface ActiveCodexTurn {
  threadId: string;
  turnId: string;
}

export interface CodexInterruptClient {
  request(
    method: 'turn/interrupt',
    params: ActiveCodexTurn,
  ): Promise<unknown>;
}

/**
 * Small testable owner for the transient turn identity required by
 * turn/interrupt. Runtime wiring still decides when a turn starts/ends, while
 * this class owns the lookup/no-active semantics without source-text regexes.
 */
export class CodexTurnInterruptRegistry {
  private readonly turns = new Map<string, ActiveCodexTurn>();

  set(sessionId: string, turn: ActiveCodexTurn): void {
    this.turns.set(sessionId, turn);
  }

  get(sessionId: string): ActiveCodexTurn | undefined {
    return this.turns.get(sessionId);
  }

  delete(sessionId: string): boolean {
    return this.turns.delete(sessionId);
  }

  issue(
    sessionId: string,
    request: (turn: ActiveCodexTurn) => void,
  ): boolean {
    const active = this.turns.get(sessionId);
    if (!active) return false;
    request(active);
    return true;
  }
}

export async function requestCodexTurnInterrupt(
  client: CodexInterruptClient,
  active: ActiveCodexTurn,
): Promise<void> {
  await client.request('turn/interrupt', {
    threadId: active.threadId,
    turnId: active.turnId,
  });
}
