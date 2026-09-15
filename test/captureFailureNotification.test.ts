import { test } from "node:test";
import assert from "node:assert/strict";
import { UserRepository } from "../src/users/userRepository.ts";
import { DeliveryLogRepository } from "../src/notifications/deliveryLogRepository.ts";
import { NotificationService } from "../src/notifications/notificationService.ts";
import { FakeEmailSender } from "./fakeEmailSender.ts";

function buildService() {
  const userRepository = new UserRepository();
  const deliveryLogRepository = new DeliveryLogRepository();
  const emailSender = new FakeEmailSender();
  const service = new NotificationService(userRepository, deliveryLogRepository, emailSender);
  return { service, emailSender, deliveryLogRepository };
}

test("AC2: final capture-failure attempt notifies the customer to update their payment method", async () => {
  const { service, emailSender } = buildService();

  await service.notifyCaptureFailureAttempt({
    transactionId: "txn-3",
    customerId: "user-customer-1",
    attemptNumber: 3,
    maxAttempts: 3,
  });

  assert.equal(emailSender.sentMessages.length, 1);
  assert.match(emailSender.sentMessages[0].body, /update your payment method/i);
});

test("AC4: a capture failure with retries remaining does not notify the customer", async () => {
  const { service, emailSender, deliveryLogRepository } = buildService();

  await service.notifyCaptureFailureAttempt({
    transactionId: "txn-4",
    customerId: "user-customer-1",
    attemptNumber: 1,
    maxAttempts: 3,
  });

  assert.equal(emailSender.sentMessages.length, 0);
  assert.equal(deliveryLogRepository.getAll().length, 0);
});
