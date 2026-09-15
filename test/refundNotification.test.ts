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

test("AC1: refund notification states the refund amount and original payment method", async () => {
  const { service, emailSender } = buildService();

  await service.notifyRefundIssued({
    transactionId: "txn-1",
    customerId: "user-customer-1",
    refundAmount: 24.5,
    currency: "USD",
    originalPaymentMethod: "Visa ending 4242",
  });

  assert.equal(emailSender.sentMessages.length, 1);
  assert.match(emailSender.sentMessages[0].body, /24\.5/);
  assert.match(emailSender.sentMessages[0].body, /Visa ending 4242/);
});

test("AC5: refund notification is delivered to the customer's account email on file", async () => {
  const { service, emailSender } = buildService();

  await service.notifyRefundIssued({
    transactionId: "txn-1b",
    customerId: "user-customer-1",
    refundAmount: 10,
    currency: "USD",
    originalPaymentMethod: "Visa ending 4242",
  });

  assert.equal(emailSender.sentMessages[0].to, "customer1@example.com");
});

test("AC8: no duplicate refund notification is sent for the same transaction ID", async () => {
  const { service, emailSender } = buildService();
  const event = {
    transactionId: "txn-2",
    customerId: "user-customer-1",
    refundAmount: 15,
    currency: "USD",
    originalPaymentMethod: "Visa ending 4242",
  };

  await service.notifyRefundIssued(event);
  await service.notifyRefundIssued(event);

  assert.equal(emailSender.sentMessages.length, 1);
});
