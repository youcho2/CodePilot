export interface IdentifiedDescriptor {
  readonly id: string;
}

export class DescriptorRegistry<T extends IdentifiedDescriptor> {
  readonly #descriptors = new Map<string, T>();
  #sealed = false;

  constructor(initial: readonly T[] = []) {
    initial.forEach((descriptor) => this.register(descriptor));
  }

  register(descriptor: T): void {
    if (this.#sealed) {
      throw new Error('Descriptor registry is sealed.');
    }
    if (!descriptor.id.trim()) {
      throw new Error('Descriptor id must not be empty.');
    }
    if (this.#descriptors.has(descriptor.id)) {
      throw new Error(`Descriptor "${descriptor.id}" is already registered.`);
    }
    this.#descriptors.set(descriptor.id, descriptor);
  }

  seal(): void {
    this.#sealed = true;
  }

  get(id: string): T | undefined {
    return this.#descriptors.get(id);
  }

  require(id: string): T {
    const descriptor = this.get(id);
    if (!descriptor) throw new Error(`Descriptor "${id}" is not registered.`);
    return descriptor;
  }

  has(id: string): boolean {
    return this.#descriptors.has(id);
  }

  list(): readonly T[] {
    return Array.from(this.#descriptors.values());
  }
}

export type HarnessIntegrationLevel = 'discover' | 'portable';

export interface HarnessAdapterDescriptor extends IdentifiedDescriptor {
  readonly displayName: string;
  readonly integrationLevels: readonly HarnessIntegrationLevel[];
  readonly sourceKinds: readonly string[];
  readonly supportsExplicitExport: boolean;
}

export type RuntimeIntegrationLevel = 'bridge' | 'full';

export interface RuntimeDescriptor extends IdentifiedDescriptor {
  readonly displayName: string;
  readonly integrationLevel: RuntimeIntegrationLevel;
  readonly capabilityIds: readonly string[];
  readonly projectionModes: readonly string[];
  readonly packagedRegistration: 'explicit';
}
