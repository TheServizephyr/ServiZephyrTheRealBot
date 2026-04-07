# Customer Lookup Flow

Ye doc current order-page customer resolution flow ko simple Hinglish me samjhata hai.

## High Level Flow

```text
WhatsApp link click
    |
    v
/order/[restaurantId]?ref=...&token=...&phone=...
    |
    v
Server wrapper page.js
    |
    v
/api/public/bootstrap/[restaurantId]
    |
    +--> Menu / business / ordering data
    |
    +--> Customer lookup
    |
    +--> Active order lookup
    |
    v
OrderPageClient ko initialBootstrap milta hai
    |
    v
Page first render + baad me client hydration
```

## Customer Lookup Actual Flow

```text
Bootstrap API start
    |
    v
Search params read:
- phone
- ref
- token
    |
    v
Cookie read:
- auth_guest_session
    |
    v
resolveCustomerLookupProfile()
    |
    +--> Case 1: ref mila
    |       |
    |       v
    |   guest_sessions/{ref}
    |       |
    |       v
    |   subjectId mil gaya?
    |       |
    |       +--> Haan -> guest_profiles/{subjectId} ya users/{subjectId}
    |       |
    |       +--> Nahi -> fallback
    |
    +--> Case 2: cookieGuestId mila
    |       |
    |       v
    |   guest_profiles/{cookieGuestId} ya users/{cookieGuestId}
    |
    +--> Case 3: logged-in uid mila
    |       |
    |       v
    |   users/{uid}
    |
    +--> Case 4: sirf phone mila
            |
            v
        getOrCreateGuestProfile(phone)
            |
            v
        guest_profiles ya users se profile load
```

## Important Truth

```text
ref != full customer data
ref -> guest_sessions -> subjectId / phone / scopes

actual customer info alag jagah hoti hai:
- guest_profiles
- users
```

## Cookie Me Kya Hota Hai

`auth_guest_session` cookie me mostly ye hota hai:

- `subjectId`
- `subjectType`
- `sessionId`
- `scopes`
- `expiry`

Cookie me normally ye nahi hota:

- full name
- all addresses
- loyalty
- full customer profile

## Real Data Kahan Se Aata Hai

```text
guest_profiles/{id}
    ya
users/{id}
```

Yahin se milta hai:

- name
- phone
- addresses
- verified / guest state

## Address Merge Flow

Kabhi-kabhi system same phone ke basis par:

- `guest_profiles`
- `users`

dono me se addresses merge karne ki koshish karta hai.

Simple matlab:
- agar guest profile me kuch addresses hain
- aur same phone wale user doc me bhi addresses hain
- to lookup response me merged addresses aa sakte hain

## Bootstrap Me Customer Miss Kyun Ho Sakta Hai

### Case 1: `ref` invalid / expired / revoked
- guest session resolve nahi hoga

### Case 2: `ref` me required scope nahi hai
- `customer_lookup` scope missing hua to reject ho sakta hai

### Case 3: cookie abhi available nahi hai
- especially first visit / fresh browser

### Case 4: profile doc abhi resolve nahi hua
- guest_profiles / users linkage incomplete ho sakti hai

### Case 5: bootstrap timeout
- customer lookup bounded timeout me wrapped hai
- menu aa jayega
- customer `resolved: false` ho sakta hai

Ye bahut important hai:

```text
Bootstrap ka target hai:
"menu fast dikhao"

Customer lookup ka target hai:
"jaldi mil gaya to do, warna page block mat karo"
```

## Current Priority Order

Roughly system customer ko is order me resolve karta hai:

1. `ref` se subjectId
2. explicit guest id
3. cookie guest id
4. logged-in uid
5. phone-based guest/profile fallback

## Practical Example

```text
Customer WhatsApp se aaya
    |
    v
Link me ref hai
    |
    v
guest_sessions/{ref} se subjectId mila = g_abc123
    |
    v
guest_profiles/g_abc123 read hua
    |
    v
name + phone + addresses bootstrap response me aa gaye
    |
    v
Order page client ko ready customer data mil gaya
```

## Dusra Example

```text
Customer WhatsApp se aaya
    |
    v
ref hai but slow / invalid / timeout ho gaya
    |
    v
bootstrap menu shell return kar deta hai
    |
    v
customer.resolved = false
    |
    v
page dikh jayega, but customer context missing lagega
```

## Final Summary

```text
WhatsApp ref is identity ticket
guest_sessions is resolver layer
guest_profiles / users is actual customer data layer
cookie is helper, not full profile storage
bootstrap fast shell ke liye hai, full blocking customer resolver nahi
```

