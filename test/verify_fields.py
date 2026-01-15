import sys
from pypdf import PdfReader

def extract_field_names(pdf_path, output_txt_path):
    print(f"--- Deep Verification: {pdf_path} ---")
    
    try:
        reader = PdfReader(pdf_path)
        # We use the raw form dictionary for deep inspection
        fields = reader.get_fields() 

        if not fields:
            print("❌ No form fields found.")
            return

        with open(output_txt_path, "w", encoding="utf-8") as f:
            f.write(f"Verification Report\n{'='*120}\n")
            f.write(f"{'FIELD NAME':<100} | {'CRITICAL?'}\n")
            f.write("-" * 120 + "\n")
            
            for field_name, field_data in fields.items():
                is_critical = "No"
                
                # Check 1: Direct Dictionary Entry
                if "/IsCritical" in field_data:
                    if str(field_data["/IsCritical"]).lower() == "true":
                        is_critical = "YES"
                
                # Check 2: Check inside the 'Kids' (Widgets)
                if is_critical == "No" and "/Kids" in field_data:
                    for kid_ref in field_data["/Kids"]:
                        kid_obj = kid_ref.get_object()
                        if "/IsCritical" in kid_obj and str(kid_obj["/IsCritical"]).lower() == "true":
                            is_critical = "YES"
                            break

                # Write full name (no slicing)
                f.write(f"{field_name:<100} | {is_critical}\n")
                
                if is_critical == "YES":
                    print(f"🚩 FOUND CRITICAL: {field_name[-50:]}") # Prints tail end of long name

        print(f"\n✅ Success! Report saved to {output_txt_path}")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    input_pdf = sys.argv[1] if len(sys.argv) > 1 else "edited_form.pdf"
    extract_field_names(input_pdf, "verified_questions.txt")