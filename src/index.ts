import { EventEmitter } from "events";

export interface QueueOptions {
	bucketSize: number;
	tokensPerInterval: number;
	interval: number;
	maxQueueSize?: number;
	autoStart?: boolean;
	operationTimeout?: number;
	maxExecutionTime?: number;
	retryAttempts?: number;
	retryDelay?: number;
}

export type QueueableOperation<T> = (() => T | Promise<T>) | Promise<T>;

interface QueueItem<T> {
	operation: QueueableOperation<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: any) => void;
	addedAt: number;
	timeout?: NodeJS.Timeout;
	attempts: number;
}

export interface QueueStatus {
	queueLength: number;
	availableTokens: number;
	isProcessing: boolean;
	isRunning: boolean;
	timestamp: number;
}

export class ThrottledQueue extends EventEmitter {
	private queue: QueueItem<any>[] = [];
	private availableTokens: number;
	private readonly maxBucketSize: number;
	private readonly maxQueueSize: number;
	private readonly tokensPerInterval: number;
	private readonly interval: number;
	private readonly operationTimeout: number;
	private readonly maxExecutionTime: number;
	private readonly retryAttempts: number;
	private readonly retryDelay: number;
	private isProcessing: boolean = false;
	private refillTimer: NodeJS.Timeout | null = null;

	constructor(options: QueueOptions) {
		super();
		this.validateOptions(options);

		this.maxBucketSize = options.bucketSize;
		this.tokensPerInterval = options.tokensPerInterval;
		this.interval = options.interval;
		this.maxQueueSize = options.maxQueueSize ?? Infinity;
		this.operationTimeout = options.operationTimeout ?? 30000;
		this.maxExecutionTime = options.maxExecutionTime ?? 60000;
		this.retryAttempts = options.retryAttempts ?? 0;
		this.retryDelay = options.retryDelay ?? 1000;
		this.availableTokens = this.maxBucketSize;

		if (options.autoStart !== false) {
			this.start();
		}
	}

	private validateOptions(options: QueueOptions): void {
		if (options.tokensPerInterval > options.bucketSize) {
			throw new Error("Rate cannot be greater than bucket size");
		}
		if (options.bucketSize < 1) {
			throw new Error("Bucket size must be at least 1");
		}
		if (options.tokensPerInterval < 1) {
			throw new Error("Rate must be at least 1");
		}
		if (options.interval < 1) {
			throw new Error("Interval must be at least 1ms");
		}
	}

	private refillTokens(): void {
		this.availableTokens = Math.min(this.maxBucketSize, this.availableTokens + this.tokensPerInterval);
		this.emit("tokens.refill", this.availableTokens);
		this.processQueue();
	}

	private async processQueue(): Promise<void> {
		if (this.isProcessing || this.queue.length === 0) return;

		this.isProcessing = true;
		this.emit("processing.start");

		try {
			while (this.queue.length > 0 && this.availableTokens > 0) {
				const item = this.queue.shift()!;
				this.availableTokens--;
				this.emit("operation.start", { queueLength: this.queue.length });

				try {
					const result = await this.executeOperation(item);
					item.resolve(result);
					this.emit("operation.success", { result });
				} catch (error) {
					await this.handleOperationError(item, error);
				}
			}

			if (this.queue.length === 0) {
				this.emit("queue.empty");
			}
		} finally {
			this.isProcessing = false;
			this.emit("processing.end");

			if (this.queue.length > 0 && this.availableTokens > 0) {
				Promise.resolve().then(() => this.processQueue());
			}
		}
	}

	private async executeOperation(item: QueueItem<any>): Promise<any> {
		const executionPromise = Promise.race([
			typeof item.operation === "function" ? item.operation() : item.operation,
			new Promise((_, reject) => {
				setTimeout(() => reject(new Error("Operation execution timeout")), this.maxExecutionTime);
			}),
		]);

		return executionPromise;
	}

	private async handleOperationError(item: QueueItem<any>, error: any): Promise<void> {
		if (item.attempts < this.retryAttempts) {
			item.attempts++;
			await new Promise(resolve => setTimeout(resolve, this.retryDelay));
			this.queue.unshift(item);
			this.emit("operation.retry", {
				error,
				attempts: item.attempts,
				maxAttempts: this.retryAttempts,
			});
		} else {
			item.reject(error);
			this.emit("operation.error", { error });
		}
	}

	enqueue<T>(operations: QueueableOperation<T>[] | QueueableOperation<T>): Promise<T[]> {
		const ops = Array.isArray(operations) ? operations : [operations];
		const now = Date.now();

		if (this.queue.length + ops.length > this.maxQueueSize) {
			return Promise.reject(new Error("Queue size limit exceeded"));
		}

		const promises = ops.map(
			operation =>
				new Promise<T>((resolve, reject) => {
					const item: QueueItem<T> = {
						operation,
						resolve,
						reject,
						addedAt: now,
						attempts: 0,
					};

					if (this.operationTimeout > 0) {
						item.timeout = setTimeout(() => {
							const index = this.queue.indexOf(item);
							if (index !== -1) {
								this.queue.splice(index, 1);
								reject(new Error("Operation timeout"));
								this.emit("operation.timeout");
							}
						}, this.operationTimeout);
					}

					this.queue.push(item);
					this.emit("operation.queued", { queueLength: this.queue.length });
				})
		);

		Promise.resolve().then(() => this.processQueue());
		return Promise.all(promises);
	}

	start(): void {
		if (!this.refillTimer) {
			this.refillTimer = setInterval(() => this.refillTokens(), this.interval);
			this.isProcessing = false;
			this.processQueue();
			this.emit("queue.start");
		}
	}

	stop(): void {
		if (this.refillTimer) {
			clearInterval(this.refillTimer);
			this.refillTimer = null;
			this.isProcessing = true;
			this.emit("queue.stop");
		}
	}

	pause(): void {
		this.isProcessing = true;
		this.emit("queue.pause");
	}

	resume(): void {
		this.isProcessing = false;
		this.processQueue();
		this.emit("queue.resume");
	}

	clear(): void {
		this.queue.forEach(item => {
			if (item.timeout) {
				clearTimeout(item.timeout);
			}
			item.reject(new Error("Queue cleared"));
		});
		this.queue = [];
		this.emit("queue.clear");
	}

	getStatus(): QueueStatus {
		return {
			queueLength: this.queue.length,
			availableTokens: this.availableTokens,
			isProcessing: this.isProcessing,
			isRunning: this.refillTimer !== null,
			timestamp: Date.now(),
		};
	}
}
