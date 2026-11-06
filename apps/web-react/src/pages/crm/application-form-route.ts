// Ön başvuru sayfasının rota sabitleri (ON-133). `routes.tsx` ilk JS'e girdiği için bu dosya bağımlılık
// taşımaz; form şeması ve core kuralları sayfanın kendi parçasında kalır.

/** Başvuru sayfasının yol parçası. */
export const APPLICATION_FORM_PATH = 'basvuru'

/** Router yolu: statik ilk parça `:role` rotasından önce eşleşmelidir. */
export const APPLICATION_FORM_ROUTE = `${APPLICATION_FORM_PATH}/:formKey`
