# ratelimit-queue

A lightweight and configurable rate-limiting queue for handling asynchronous operations.

## Features

-   Token bucket algorithm implementation
-   Operation timeout management
-   Automatic retry mechanism
-   Event-driven architecture
-   Comprehensive error handling
-   Queue status monitoring
-   TypeScript support
-   Promise-based API
-   Pause/Resume capability

## Token Bucket Algorithm

The queue uses the token bucket algorithm for rate limiting. Think of it like a bucket that:

-   Has a maximum capacity (`bucketSize`)
-   Receives new tokens at a fixed rate (`tokensPerInterval` tokens every `interval` milliseconds)
-   Each operation consumes one token
-   If the bucket is full, new tokens are discarded
-   If the bucket is empty, operations wait for new tokens

This algorithm allows for:

-   Burst capacity handling (up to `bucketSize`)
-   Smooth rate limiting over time (controlled by `tokensPerInterval`)
-   Efficient resource usage
-   Predictable operation scheduling

## Installation

```bash
npm i ratelimit-queue
```

## Quick Start

```typescript
import { ThrottledQueue } from "ratelimit-queue";

// Create a queue with:
// - Maximum of 20 tokens (burst capacity)
// - Refills 10 tokens per second
// - Can handle temporary bursts of up to 20 operations
// - After burst, settles to 10 operations per second on average
const queue = new ThrottledQueue({
	bucketSize: 20, // Maximum tokens available at any time
	tokensPerInterval: 10, // Tokens added per interval
	interval: 1000, // Interval in milliseconds
	maxQueueSize: 100, // Optional: limit queue size
	operationTimeout: 5000, // Optional: operation timeout in ms
	maxExecutionTime: 10000, // Optional: max execution time per operation
	retryAttempts: 3, // Optional: number of retry attempts
	retryDelay: 1000, // Optional: delay between retries in ms
});

// Listen to queue events
queue.on("operation.success", ({ result }) => {
	console.log("Operation completed:", result);
});

queue.on("operation.error", ({ error }) => {
	console.error("Operation failed:", error);
});

// Enqueue operations
async function example() {
	try {
		const results = await queue.enqueue([
			() => fetch("https://api.example.com/1"),
			() => fetch("https://api.example.com/2"),
		]);
		console.log("Results:", results);
	} catch (error) {
		console.error("Queue error:", error);
	}
}
```

## API Reference

### `ThrottledQueue`

#### Constructor Options

```typescript
interface QueueOptions {
	bucketSize: number; // Maximum number of tokens
	tokensPerInterval: number; // Tokens added per interval
	interval: number; // Interval in milliseconds
	maxQueueSize?: number; // Maximum queue size
	autoStart?: boolean; // Start processing immediately
	operationTimeout?: number; // Operation timeout in ms
	maxExecutionTime?: number; // Max execution time per operation
	retryAttempts?: number; // Number of retry attempts
	retryDelay?: number; // Delay between retries in ms
}
```

#### Methods

##### `enqueue<T>(operations: QueueableOperation<T>[] | QueueableOperation<T>): Promise<T[]>`

Adds operations to the queue. Returns a promise that resolves when all operations complete.

```typescript
const results = await queue.enqueue([() => Promise.resolve(1), () => Promise.resolve(2)]);
```

##### `start(): void`

Starts the queue processing and token refill timer.

##### `stop(): void`

Stops the queue processing and token refill timer.

##### `pause(): void`

Temporarily pauses queue processing.

##### `resume(): void`

Resumes queue processing.

##### `clear(): void`

Clears all pending operations from the queue.

##### `getStatus(): QueueStatus`

Returns the current status of the queue.

```typescript
interface QueueStatus {
	queueLength: number;
	availableTokens: number;
	isProcessing: boolean;
	isRunning: boolean;
	timestamp: number;
}
```

#### Events

The queue emits the following events:

-   `tokens.refill`: When tokens are refilled
-   `processing.start`: When queue processing starts
-   `processing.end`: When queue processing ends
-   `operation.start`: When an operation starts
-   `operation.success`: When an operation completes successfully
-   `operation.error`: When an operation fails
-   `operation.retry`: When an operation is retried
-   `operation.timeout`: When an operation times out
-   `operation.queued`: When an operation is added to the queue
-   `queue.empty`: When the queue becomes empty
-   `queue.start`: When the queue is started
-   `queue.stop`: When the queue is stopped
-   `queue.pause`: When the queue is paused
-   `queue.resume`: When the queue is resumed
-   `queue.clear`: When the queue is cleared

## Error Handling

The queue handles various error scenarios:

-   Queue size limit exceeded
-   Operation timeout
-   Operation execution timeout
-   Operation failures with retry mechanism
-   Queue cleared while operation is pending

```typescript
queue.on("operation.error", ({ error }) => {
	console.error("Operation failed:", error);
});

queue.on("operation.retry", ({ error, attempts, maxAttempts }) => {
	console.log(`Retrying operation: ${attempts}/${maxAttempts}`);
});
```

## Example: Rate Limited API Calls

```typescript
const apiQueue = new ThrottledQueue({
	bucketSize: 60,
	tokensPerInterval: 30,
	interval: 60000, // 30 requests per minute, burst of 60
	retryAttempts: 3,
});

async function fetchUsers() {
	const userIds = [1, 2, 3, 4, 5];
	const operations = userIds.map(id => () => fetch(`https://api.example.com/users/${id}`));

	try {
		const responses = await apiQueue.enqueue(operations);
		return Promise.all(responses.map(r => r.json()));
	} catch (error) {
		console.error("Failed to fetch users:", error);
		throw error;
	}
}
```

## License

SIC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
