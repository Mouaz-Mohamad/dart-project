  function bindAuth() {
    document.addEventListener(
      "submit",
      async (event) => {
        const form = event.target;
        if (form.id === "serialSearchForm") {
          event.preventDefault();
          if (!form.checkValidity()) {
            form.reportValidity();
            return;
          }
          await renderSerialResult(form);
          return;
        }
        if (
          [
            "registerForm",
            "customerEmailVerificationForm",
            "loginForm",
            "customerAccountPasswordForm",
            "checkoutForm",
            "contactForm",
            "reviewForm",
            "returnRequestForm",
          ].includes(form.id) &&
          !form.checkValidity()
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          form.reportValidity();
          return;
        }
        if (form.id === "registerForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            const result = await register(Object.fromEntries(new FormData(form)));
            if (result?.status === "verification_required") {
              const dialog = document.getElementById("customerEmailVerification");
              const verificationForm = document.getElementById(
                "customerEmailVerificationForm",
              );
              verificationForm.elements.challengeId.value = result.challengeId;
              dialog.hidden = false;
              verificationForm.elements.code.focus();
              setStatus(form, "تم إرسال كود التأكيد إلى بريدك الإلكتروني.");
            } else {
              setStatus(form, "تم إنشاء الحساب بنجاح.");
              location.assign(requestedAuthDestination());
            }
          } catch (error) {
            setStatus(form, error.message, true);
          }
        } else if (form.id === "customerEmailVerificationForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            await verifyEmail(form.elements.challengeId.value, form.elements.code.value);
            sessionStorage.removeItem("dart_pending_email_verification");
            setStatus(form, "تم تأكيد الحساب بنجاح.");
            setTimeout(() => location.assign(requestedAuthDestination()), 450);
          } catch (error) {
            setStatus(form, error.message, true);
          }
        } else if (form.id === "loginForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            const user = await login(
              form.elements.identifier.value,
              form.elements.password.value,
            );
            setStatus(form, "تم تسجيل الدخول بنجاح.");
            if (user.mustChangePassword) {
              const dialog = document.getElementById("customerPasswordChange");
              if (dialog) dialog.hidden = false;
            } else
              location.assign(requestedAuthDestination());
          } catch (error) {
            setStatus(form, error.message, true);
          }
        } else if (form.id === "customerChangePasswordForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            await replaceTemporaryPassword(
              form.elements.password.value,
              form.elements.confirmPassword.value,
            );
            setStatus(form, "Password changed successfully.");
            setTimeout(() => location.assign(requestedAuthDestination()), 400);
          } catch (error) {
            setStatus(form, error.message, true);
          }
        } else if (form.id === "customerAccountPasswordForm") {
          event.preventDefault();
          event.stopImmediatePropagation();
          try {
            await changeOwnPassword(
              form.elements.currentPassword.value,
              form.elements.password.value,
              form.elements.confirmPassword.value,
            );
            form.reset();
            setStatus(form, "Password changed successfully. Other active sessions were signed out.");
          } catch (error) {
            setStatus(form, error.message, true);
          }
        } else if (form.id === "checkoutForm") {
          // The form handler owns price review; its address-wait capture handler
          // must run before submission reaches that handler.
          if (form.dataset.dartCheckoutHandler === "ui") return;
          event.preventDefault();
          event.stopImmediatePropagation();
          setStatus(form, "تعذر تحميل إتمام الطلب. أعد تحميل الصفحة ثم حاول مرة أخرى.", true);
        } else if (form.id === "contactForm") {
          event.preventDefault();
          // BEGIN Contact Us -> dashboard Review inbox.
          // BACKEND: create this record through one authenticated/admin-readable inbox endpoint.
          const values = Object.fromEntries(new FormData(form));
          if (API_BASE) {
            try {
              await apiRequest("/api/v1/contact", {
                method: "POST",
                body: {
                  fullName: values.full_name,
                  email: values.email,
                  phone1: values.phone1,
                  ...(values.phone2 ? { phone2: values.phone2 } : {}),
                  message: values.message,
                },
              });
              form.reset();
              setStatus(form, "تم استلام رسالتك وسنتواصل معك.");
            } catch (error) {
              setStatus(form, error.message, true);
            }
            return;
          }
          const customers = read(KEYS.customers, []);
          const customer = customers.find(
            (row) =>
              normalizeEmail(row.email) === normalizeEmail(values.email) ||
              normalizePhone(row.phone1) === normalizePhone(values.phone1) ||
              normalizePhone(row.phone2) === normalizePhone(values.phone1),
          );
          const rows = read(KEYS.reviews, []);
          const message = {
            id: uid("MSG"),
            source: "Contact Us",
            recordType: "contact",
            clientId: customer?.clientId || "-",
            clientName: values.full_name || customer?.clientName || "-",
            rating: "-",
            title: "-",
            review: values.message || "-",
            phone1: displayPhone(values.phone1) || "-",
            phone2: displayPhone(values.phone2) || "-",
            email: normalizeEmail(values.email) || "-",
            status: "-",
            date: dateGB(),
            createdAt: now(),
            isArchived: false,
            isDeleted: false,
            isChecked: false,
          };
          rows.unshift(message);
          write(KEYS.reviews, rows);
          audit("CREATE", "contact", message.id, { source: "Contact Us" });
          form.reset();
          setStatus(form, "تم استلام رسالتك وسنتواصل معك.");
          // END Contact Us -> dashboard Review inbox.
        } else if (form.id === "reviewForm") {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(form)),
            user = currentUser(),
            orders = read(KEYS.orders, []);
          if (API_BASE) {
            if (!user) {
              setStatus(form, "سجل الدخول أولًا لإرسال تقييم.", true);
              return;
            }
            try {
              await apiRequest("/api/v1/reviews", {
                method: "POST",
                body: {
                  rating: Number(values.rating),
                  title: values.title,
                  review: values.review,
                },
              });
              form.reset();
              form.elements.full_name.value = user.name;
              form.elements.phone1.value = displayPhone(user.phone1);
              form.elements.phone2.value = displayPhone(user.phone2);
              form.elements.email.value = user.email;
              setStatus(form, "تم إرسال التقييم للمراجعة.");
            } catch (error) {
              setStatus(form, error.message, true);
            }
            return;
          }
          const eligible =
            user &&
            orders.some(
              (o) => o.clientId === user.customerId && o.status === "Delivered",
            );
          if (!eligible) {
            setStatus(form, "يمكنك إرسال تقييم بعد استلام طلبك الأول.", true);
            return;
          }
          const rows = read(KEYS.reviews, []);
          rows.unshift({
            id: uid("REV"),
            source: "Review",
            recordType: "review",
            clientId: user.customerId,
            clientName: user.name,
            rating: Number(values.rating),
            title: values.title,
            review: values.review,
            phone1: displayPhone(user.phone1),
            phone2: displayPhone(user.phone2) || "-",
            email: user.email,
            status: "Pending",
            date: dateGB(),
            createdAt: now(),
            isArchived: false,
            isDeleted: false,
            isChecked: false,
          });
          write(KEYS.reviews, rows);
          form.reset();
          form.elements.full_name.value = user.name;
          form.elements.phone1.value = displayPhone(user.phone1);
          form.elements.phone2.value = displayPhone(user.phone2);
          form.elements.email.value = user.email;
          setStatus(form, "تم إرسال التقييم للمراجعة.");
        } else if (form.id === "returnRequestForm") {
          event.preventDefault();
          const addressController =
            window.dartReturnAddress || window.DartAddress?.initReturnRequest?.();
          const addressValidation = addressController?.validate?.();
          if (!addressValidation?.ok) {
            setStatus(
              form,
              addressValidation?.message ||
                "حدد مكان استلام المرتجع على الخريطة أو اكتب العنوان كاملًا.",
              true,
            );
            return;
          }
          const values = Object.fromEntries(new FormData(form));
          const rules = returnRules();
          const requestType = rules?.normalizeType(values.request_type) || "";
          if (!requestType) {
            setStatus(form, "اختر استبدال أو استرجاع.", true);
            return;
          }
          if (API_BASE) {
            try {
              const result = await apiRequest("/api/v1/returns", {
                method: "POST",
                body: {
                  itemCode: values.item_code,
                  requestType,
                  reason: values.reason,
                  ...(values.notes ? { notes: values.notes } : {}),
                  ...(requestType === "Exchange"
                    ? {
                        requestedColor: values.exchange_color,
                        requestedSize: values.exchange_size,
                      }
                    : {}),
                  address: {
                    country: values.country,
                    governorate: values.governorate,
                    area: values.area,
                    street: values.street,
                    building: values.building,
                    floor: values.floor,
                    latitude: Number(values.latitude),
                    longitude: Number(values.longitude),
                    ...(values.full_address ? { fullAddress: values.full_address } : {}),
                    addressSource:
                      addressValidation.source || form.dataset.dartAddressSource || "map",
                  },
                },
              });
              sessionStorage.setItem("dart_last_return_id", result.returnId);
              void Promise.resolve().then(hydrateCustomerCommerce).then(renderProfile).catch(() => {});
              form.reset();
              const trackingLink = document.getElementById("return-tracking-link");
              if (trackingLink) {
                trackingLink.href = `track.html?return=${encodeURIComponent(result.returnId)}`;
                trackingLink.hidden = false;
              }
              setStatus(
                form,
                `تم إنشاء الطلب ${result.returnId}. سيظهر تلقائيًا في صفحة تتبع طلبك.`,
              );
            } catch (error) {
              setStatus(form, error.message, true);
            }
            return;
          }
          const orders = read(KEYS.orders, []);
          const order = deliveredOrderForItem(values.item_code, orders);
          const identityOk =
            order &&
            (normalizeEmail(order.email) === normalizeEmail(values.email) ||
              normalizePhone(order.phone1) === normalizePhone(values.phone1));
          const deliveredAt =
            order &&
            new Date(order.deliveredAt || order.updatedAt || order.createdAt);
          const within =
            deliveredAt &&
            !Number.isNaN(deliveredAt.getTime()) &&
            Date.now() - deliveredAt.getTime() <= 14 * 864e5;
          if (!order || !identityOk || !within) {
            setStatus(
              form,
              "القطعة غير مؤهلة: يلزم طلب مستلم لنفس العميل وخلال 14 يومًا.",
              true,
            );
            return;
          }
          const rows = read(KEYS.returns, []);
          if (
            rows.some(
              (r) =>
                String(r.itemCode) === String(values.item_code) &&
                !r.isDeleted &&
                (rules?.isRefund(r) || r.requestType === "Refund") &&
                (rules?.isCompleted(r) || ["Completed", "Good", "Damaged", "Bad"].includes(r.status)),
            )
          ) {
            setStatus(form, "تم إتمام استرجاع هذه القطعة من قبل، ولا يمكن استرجاعها مرة أخرى.", true);
            return;
          }
          if (
            rows.some(
              (r) =>
                r.itemCode === values.item_code &&
                !["Rejected", "Closed", "Completed", "Good", "Damaged"].includes(r.status),
            )
          ) {
            setStatus(form, "يوجد طلب قائم لهذه القطعة بالفعل.", true);
            return;
          }
          const orderLine = (order.priceSnapshot || []).find(
              (line) => String(line.itemCode) === String(values.item_code),
            ),
            inventory = read(KEYS.items, []),
            inventoryItem = inventory.find(
              (item) => String(item.itemCode) === String(values.item_code),
            ),
            modelCode = orderLine?.modelCode || inventoryItem?.modelId || "";
          if (!modelCode) {
            setStatus(
              form,
              "تعذر ربط رقم القطعة بالتصميم. راجع خدمة العملاء.",
              true,
            );
            return;
          }
          let replacementCandidates = [];
          if (requestType === "Exchange") {
            replacementCandidates = inventory.filter(
              (item) =>
                !item.isArchived &&
                !item.isDeleted &&
                String(item.status || "").toLowerCase() === "in stock" &&
                String(item.modelId) === String(modelCode) &&
                String(item.color) === String(values.exchange_color) &&
                String(item.size) === String(values.exchange_size),
            );
            if (!values.exchange_color || !values.exchange_size || !replacementCandidates.length) {
              setStatus(
                form,
                "اللون أو المقاس البديل غير متاح حاليًا لنفس التصميم.",
                true,
              );
              return;
            }
          }
          const exchangeChainId =
              rules?.chainIdForItem(inventoryItem, values.item_code) ||
              values.item_code,
            completedExchanges =
              rules?.completedExchangeCount(rows, exchangeChainId) || 0,
            courierPolicy = rules?.courierPolicy(requestType, completedExchanges) || {
              customerFee: 0,
              brandFee: 0,
              payer: "None",
            },
            allocatedAmount =
              rules?.allocatedNetAmount(order, values.item_code) || 0;
          const row = {
            id: uid("RETDB"),
            returnId: nextCode("R", rows, "returnId"),
            orderId: order.orderId,
            clientId: order.clientId,
            clientName: values.full_name,
            itemCode: values.item_code,
            modelId: modelCode,
            phone1: values.phone1,
            phone2: values.phone2 || "-",
            email: normalizeEmail(values.email),
            requestType,
            reason: values.reason,
            status: "Pending Request",
            inspectionStatus: "Pending",
            notes: values.notes || "",
            originalLineSnapshot: orderLine ? { ...orderLine } : null,
            originalNetAmount: allocatedAmount,
            refundAmount: requestType === "Refund" ? allocatedAmount : 0,
            exchangeValue: requestType === "Exchange" ? allocatedAmount : 0,
            exchangeChainId,
            completedExchangesBeforeRequest: completedExchanges,
            requestedColor: requestType === "Exchange" ? values.exchange_color : "",
            requestedSize: requestType === "Exchange" ? values.exchange_size : "",
            replacementCandidateCount: replacementCandidates.length,
            customerCourierFee: courierPolicy.customerFee,
            brandCourierFee: courierPolicy.brandFee,
            courierFeePayer: courierPolicy.payer,
            customerCourierFeeStatus: courierPolicy.customerFee ? "Due to Representative" : "Not Applicable",
            brandCourierFeeStatus: courierPolicy.brandFee ? "Due to Representative" : "Not Applicable",
            country: values.country,
            governorate: values.governorate,
            area: values.area,
            street: values.street,
            building: values.building,
            floor: values.floor,
            latitude: Number(values.latitude),
            longitude: Number(values.longitude),
            fullAddress: values.full_address,
            addressSource: addressValidation.source || form.dataset.dartAddressSource || "map",
            isPostDeliveryReturn: true,
            date: dateGB(),
            createdAt: now(),
            isArchived: false,
            isDeleted: false,
            isChecked: false,
          };
          rows.push(row);
          write(KEYS.returns, rows);
          notify(
            "return_created",
            `Return ${row.returnId}`,
            `${row.itemCode}: ${requestType} requested by customer.`,
            "returns",
            row.id,
          );
          sessionStorage.setItem("dart_last_return_id", row.returnId);
          form.reset();
          const trackingLink = document.getElementById("return-tracking-link");
          if (trackingLink) {
            trackingLink.href = `track.html?return=${encodeURIComponent(row.returnId)}`;
            trackingLink.hidden = false;
          }
          setStatus(
            form,
            `تم إنشاء الطلب ${row.returnId}. سيظهر تلقائيًا في صفحة تتبع طلبك.`,
          );
          renderProfile();
        }
      },
      true,
    );

    document.addEventListener("click", (event) => {
      const passwordToggle = event.target.closest("[data-change-password-toggle]");
      if (passwordToggle) {
        event.preventDefault();
        const form = document.getElementById("customerAccountPasswordForm");
        if (form) {
          form.hidden = !form.hidden;
          if (!form.hidden) form.elements.currentPassword?.focus();
        }
        return;
      }
      const forgot = event.target.closest("[data-forgot-password]");
      if (forgot) {
        event.preventDefault();
        const hint = document.getElementById("loginForm")?.elements?.identifier?.value || "";
        openPasswordReset("customer", hint);
      }
      const social = event.target.closest("[data-social-login]");
      if (social) {
        event.preventDefault();
        window.DartDialog.alert("تسجيل الدخول الاجتماعي غير مفعّل حاليًا.");
      }
      const resend = event.target.closest("[data-resend-email-verification]");
      if (resend) {
        const form = document.getElementById("customerEmailVerificationForm");
        const challengeId = form?.elements.challengeId.value;
        if (!challengeId) return;
        resend.disabled = true;
        apiRequest("/api/v1/auth/resend-verification", {
          method: "POST",
          body: { challengeId },
        })
          .then((result) => {
            form.elements.challengeId.value = result.challengeId;
            setStatus(form, "تم إرسال كود جديد إلى بريدك الإلكتروني.");
          })
          .catch((error) => setStatus(form, error.message, true))
          .finally(() => {
            resend.disabled = false;
          });
      }
    });
  }

