import puppeteer from 'puppeteer';

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    
    await page.goto('http://localhost:8765', { waitUntil: 'networkidle2', timeout: 10000 });
    
    // Charger une sauvegarde avec train
    const saveFile = 'Fabrice__Auto__Atout2_1';
    const result = await page.evaluate((save) => {
      // Vérifier que la fonction renderInfo existe et que le code wagon est compilé
      return typeof renderInfo === 'function';
    }, saveFile);
    
    console.log('renderInfo fonction trouvée:', result);
    
    // Chercher le texte "État des wagons" dans le code source
    const pageSource = await page.content();
    if(pageSource.includes('État des wagons')) {
      console.log('✓ Texte "État des wagons" trouvé dans le HTML (probablement comme string dans le JS)');
    }
    
    await browser.close();
    process.exit(0);
  } catch(err) {
    console.error('Erreur:', err);
    if(browser) await browser.close();
    process.exit(1);
  }
})();
