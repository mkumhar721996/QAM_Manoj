import { test } from "node:test";
import assert from "node:assert/strict";
import { UserRepository } from "../src/users/userRepository.ts";
import { DeliveryLogRepository } from "../src/notifications/deliveryLogRepository.ts";
import { NotificationService } from "../src/notifications/notificationService.ts";
import { FakeEmailSender } from "./fakeEmailSender.ts";

const refundEvent = {
  transactionId: "txn-5",
  customerId: "user-customer-1",
  refundAmount: 30,
  currency: "USD",
  originalPaymentMethod: "Visa ending 4242",
};

test("AC3: a delivered notification is logged with a timestamp and recipient identifier", async () => {
  const userRepository = new UserRepository();
  const deliveryLogRepository = new DeliveryLogRepository();
  const emailSender = new FakeEmailSender();
  const service = new NotificationService(userRepository, deliveryLogRepository, emailSender);

  const before = Date.now();
  await service.notifyRefundIssued(refundEvent);
  const [entry] = deliveryLogRepository.getAll();

  assert.equal(entry.recipientEmail, "customer1@example.com");
  assert.ok(entry.timestamp >= before);
  assert.equal(entry.status, "sent");
});

test("AC6: a failed delivery attempt is automatically retried a fixed number of times", async () => {
  const userRepository = new UserRepository();
  const deliveryLogRepository = new DeliveryLogRepository();
  const emailSender = new FakeEmailSender({ failTimes: 2 });
  const service = new NotificationService(userRepository, deliveryLogRepository, emailSender);

  await service.notifyRefundIssued({ ...refundEvent, transactionId: "txn-6" });

  assert.equal(emailSender.attemptCount, 3);
  assert.equal(deliveryLogRepository.getAll()[0].status, "sent");
});

test("AC7: a notification is logged as permanently failed once all retries are exhausted", async () => {
  const userRepository = new UserRepository();
  const deliveryLogRepository = new DeliveryLogRepository();
  const emailSender = new FakeEmailSender({ failTimes: Infinity });
  const service = new NotificationService(userRepository, deliveryLogRepository, emailSender);

  await service.notifyRefundIssued({ ...refundEvent, transactionId: "txn-7" });

  assert.equal(emailSender.attemptCount, 3);
  assert.equal(deliveryLogRepository.getAll()[0].status, "permanently_failed");
});
