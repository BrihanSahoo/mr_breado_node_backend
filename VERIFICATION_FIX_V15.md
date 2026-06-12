# Verification Fix v15

- Keeps Razorpay create-order logic unchanged.
- Rider/restaurant verification submit now updates the latest request for the same user/type instead of creating repeated duplicates.
- Replaces old uploaded docs for the request when resubmitted.
- Admin verification list returns only latest unique requests.
- Admin verification detail now returns submitted payload fields flattened: mobile, aadhaar, driving license, vehicle RC, address, GST, PAN, FSSAI, etc.
- Document links are returned as absolute view/download URLs so the admin panel can open the uploaded images/PDFs.
