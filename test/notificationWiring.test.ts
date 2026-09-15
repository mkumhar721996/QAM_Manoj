import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./testServer.ts";
import { DeliveryLogRepository } from "../src/notifications/deliveryLogRepository.ts";
import { FakeEmailSender } from "./fakeEmailSender.ts";

test("NotificationService is wired into the running application and reachable via its dependency graph", async () => {
  const deliveryLogRepository = new DeliveryLogRepository();
  const emailSender = new FakeEmailSender();
  const server = await startTestServer({ deliveryLogRepository, emailSender });

  try {
    await server.app.notificationService.notifyRefundIssued({
      transactionId: "txn-wiring-1",
      customerId: "user-customer-1",
      refundAmount: 12.34,
      currency: "USD",
      originalPaymentMethod: "Visa ending 4242",
    });

    assert.equal(emailSender.sentMessages.length, 1);
    assert.equal(deliveryLogRepository.getAll()[0].status, "sent");
  } finally {
    await server.close();
  }
});
