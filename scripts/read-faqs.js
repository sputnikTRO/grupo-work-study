import { google } from 'googleapis';

const DOC_ID = '1OS9dMG7kdKGN2S-ch0uVYbyFLOGggCldCfWoibQ3Y7g';
const SERVICE_ACCOUNT_EMAIL = 'grupo-w-s@travel-bot-490001.iam.gserviceaccount.com';
const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDCEUQAusjmVI3o
7FdRrnxQGdKT5yQuD1crpTFloTKmZD1fjd5ebphPnXQ9YpWjIeji6akxGL+vR1A6
Mdkx61JbqBdayB9bXDq5RbE2/hzNN7dTsNdFU8OjT0xvMGm+f1JN8LcaiVrHuiqU
uEB4Xril7mQZFyMAXpV7nx7rsN0aOlnB3sOEb1+rAGsxV30hHst29ebC1wsgpZIo
TQZ0hhC1tCfoyNr4di7hUBcxjg1xEkeIUa+uFjohrbZIJWbRyO91gpQASZHr6jgj
1Psw9t40fhXd6yL++DwyRP7tGji92746BHrMuQQqrCvSc1Byh/HJhE38EHGdy6b7
hm0PgW07AgMBAAECggEAW3wFKSzkUQRSI5fqb+SH0MDjjnqbiSUNLFOC7kxn0p2V
ewqnZa/QGFP6/IcRUGZHYVTSQAVRM4E0NkLShyBOYkviupZ1hb18J2PNr0VqcWmP
ACJw0Ms0gjN7Lj1N1BI0S+6qepV+mIHP2ezj43qPpBU11cgc5WsxH6Y6ztPA30AJ
ITS04FlwzLHQOYZHRPohmbgW4iYkveehI3QAlAIX8T4hCaHVzOBwXuhL9q2oelPl
aebXu5Uv4dof7J9SM2+L7EHtN+aB4vVCHsXxic/dxrC4I1UUl4NZQm17g7a9qPss
SpYS6kSe1GLS0z/6Aoshta19gs63ZkRMmEUXRWXlJQKBgQDrhAGqycj5h62mYVUr
uhqtmCI5OaxjY8IAkMgF7d7g4S6vVZrtxvT4Ks7FhqyMPbcfUbXXUP3cxntKjZVk
1rRkuyCEyortsN+sEBS04ZJTKetog3ZBgPg9BBPnO3iuLzYFLk/ZR8LyNAsAirZ3
bI/VvFZ4jebgsNEr1wy3VC83twKBgQDS8l99E0b6LeQ5/4wduiYbNjZVUoj5e0AX
wQyT19+lTT9c2/3qnmWOZ1DqdlhOxlBkJ1fljUa9MeGvead4xUJHdBiW5iHt53K6
z7l19DtxSYDGrxyDOQRvnD5ouC/+37JaXV4q+0WvDNogiVZpKagtnJVoBBm2eIz2
bdlIiAHOnQKBgQDRR1Aj74MDGSmZe0wvuwQR1eozZ6hj+TVfQ0g63JD8y5yseSle
uTjdfUyYAYA6bmzXC8jGOFYdZNISAZYLMS7Dg/T1ivXBGTbosrFzui5IcCubh5YB
xxTPQ1xcUWB/h7w9BlY2Aaqdhtlv9dMGdBWsG9vK7G2IpBZ7GnFWRxxeKQKBgAIj
IoSJ5XYzcNSFmk3SzQAJlJNYurqMXSHgetgkn8d0+Odf8zqlUDIZKeC2Qj7KE5Zw
L5vLyqOwFbFJckDu/rTqoDUnL8DRT4BFCoP/bXrAW+WncIqD0V+wHZHCC/pxGcWA
nKui0Bnt72fU/GMkYOfVZk4ffIM0xXjZtBHgDuShAoGAUDwwcYjWX9q4/MT6LONZ
SYef6EEDSHmrs9krCo7oAKVZYISTz7Rx5boEDmKQ/mcQeybwzTrSUmyCQZ+3bL8w
d7bVWq0iM1WDqLZpiI9pAYZIqqCsAnoDQB3wLgpa4ckZi64GFEeP++c7Lglfz24Q
hGqRJj91+arunvKboZno0Sw=
-----END PRIVATE KEY-----`;

async function readFAQDoc() {
  console.log('📖 Leyendo documento de FAQs...\n');

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: PRIVATE_KEY,
      },
      scopes: [
        'https://www.googleapis.com/auth/documents.readonly',
        'https://www.googleapis.com/auth/drive.readonly'
      ],
    });

    const docs = google.docs({ version: 'v1', auth });

    const response = await docs.documents.get({
      documentId: DOC_ID,
    });

    const doc = response.data;
    console.log(`📄 Título: ${doc.title}\n`);

    // Extract text content
    let fullText = '';

    if (doc.body && doc.body.content) {
      for (const element of doc.body.content) {
        if (element.paragraph) {
          for (const textElement of element.paragraph.elements) {
            if (textElement.textRun) {
              fullText += textElement.textRun.content;
            }
          }
        }
      }
    }

    console.log('📝 Contenido extraído:\n');
    console.log(fullText);
    console.log('\n' + '='.repeat(80) + '\n');

    // Try to parse FAQs
    const lines = fullText.split('\n').filter(line => line.trim());

    console.log('📋 FAQs parseados:\n');

    let currentQuestion = null;
    let currentAnswer = '';
    const faqs = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if it's a question (ends with ?)
      if (line.endsWith('?')) {
        // Save previous FAQ if exists
        if (currentQuestion && currentAnswer) {
          faqs.push({
            question: currentQuestion,
            answer: currentAnswer.trim()
          });
          console.log(`Q: ${currentQuestion}`);
          console.log(`A: ${currentAnswer.trim()}\n`);
        }

        // Start new FAQ
        currentQuestion = line;
        currentAnswer = '';
      } else if (currentQuestion && line) {
        // Accumulate answer
        currentAnswer += line + ' ';
      }
    }

    // Save last FAQ
    if (currentQuestion && currentAnswer) {
      faqs.push({
        question: currentQuestion,
        answer: currentAnswer.trim()
      });
      console.log(`Q: ${currentQuestion}`);
      console.log(`A: ${currentAnswer.trim()}\n`);
    }

    console.log(`\n✅ Total de FAQs encontrados: ${faqs.length}`);

    // Save to JSON for next script
    const fs = await import('fs');
    fs.writeFileSync('/tmp/faqs.json', JSON.stringify(faqs, null, 2));
    console.log('💾 FAQs guardados en /tmp/faqs.json');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 403) {
      console.error('\n⚠️  Asegúrate de haber compartido el documento con:');
      console.error(`   ${SERVICE_ACCOUNT_EMAIL}`);
    }
    process.exit(1);
  }
}

readFAQDoc();
