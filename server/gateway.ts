import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { AppError, id } from './domain.js';

export function validSignature(body: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export interface RefundResult {
  id: string;
  status: string;
  payment_id: string;
  amount: number;
}
export interface Gateway {
  createOrder(amount: number, receipt: string): Promise<{ id: string }>;
  refund(paymentId: string, amount: number, receipt: string): Promise<RefundResult>;
  findRefund(paymentId: string, receipt: string): Promise<RefundResult | undefined>;
}
export class DemoGateway implements Gateway {
  async createOrder() {
    return { id: `order_demo_${id()}` };
  }
  async refund(paymentId: string, amount: number) {
    return { id: `refund_demo_${id()}`, status: 'processed', payment_id: paymentId, amount };
  }
  async findRefund() {
    return undefined;
  }
}
export class RazorpayGateway implements Gateway {
  private async call(path: string, body?: unknown) {
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new AppError(
        502,
        'The payment provider could not complete this request. Please try again shortly.',
      );
    return response.json();
  }
  async createOrder(amount: number, receipt: string) {
    return this.call('/orders', { amount, currency: 'INR', receipt });
  }
  async refund(paymentId: string, amount: number, receipt: string) {
    return this.call(`/payments/${encodeURIComponent(paymentId)}/refund`, {
      amount,
      receipt,
      speed: 'normal',
    });
  }
  async findRefund(paymentId: string, receipt: string): Promise<RefundResult | undefined> {
    const response = await this.call(
      `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`,
    );
    return response.items?.find((item: { receipt?: string }) => item.receipt === receipt);
  }
}
